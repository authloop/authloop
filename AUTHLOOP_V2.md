# AuthLoop v2 — Architecture & Implementation Plan

No backward compatibility required. Clean rewrites where needed.

## Architecture Decisions

| Decision | Choice | Why |
|---|---|---|
| Browser capture | Chrome extension only | Drops CDP risk surface. Extension uses `chrome.debugger` (sandboxed, permissioned, user-visible). No open network ports. |
| Agent-side CDP | Removed entirely | Agents never touch the browser. Extension handles all capture + input dispatch. |
| Video transport | LiveKit (WebRTC) | Hardware H.264/VP9 encoding, adaptive bitrate, sub-100ms latency. `tabCapture` → `MediaStreamTrack` → LiveKit. No JPEG encode/decode. |
| Event transport | WebSocket relay (existing DO) for session control. LiveKit data channel for E2EE input during Viewport. | Session control stays on infra we own. Input goes through LiveKit only when video is active. |
| E2EE | ECDH P-256 + AES-256-GCM via Web Crypto API | `node:crypto` won't run in extensions/browsers. Web Crypto works everywhere (Node 18+, Chrome, mobile). |
| Extension auth | Device-scoped tokens (pairing code flow) | Narrower scope than API keys. 1-hour access token + long-lived refresh token. Device tokens can only receive sessions and stream — cannot create sessions or manage keys. |
| Detection | DOM heuristics (no AI) | Classify auth type → route to Form Relay / Viewport / Push Remind. Same heuristics run in extension via `chrome.debugger`. |

## Package Architecture

```
authloop/ (open-source)                    platform/ (private)
├── packages/                              ├── apps/
│   ├── sdk/          HTTP client          │   ├── api/          Hono + CF Workers
│   ├── core/         Protocol + E2EE +    │   │   ├── routes/   REST endpoints
│   │                 detection + types     │   │   ├── relay.ts  session relay DO
│   ├── mcp/          MCP server           │   │   ├── ext-relay.ts  extension DO (NEW)
│   ├── extension/    Chrome extension     │   │   └── lib/      KV, LiveKit helpers
│   └── openclaw-plugin/                   │   └── web/          Next.js dashboard + viewer
│                                          │       ├── session/   Form Relay / Viewport UI
│                                          │       └── dashboard/ pairing, devices
│                                          └── packages/
│                                              └── db/           Drizzle schema
```

### What Gets Deleted (no backward compat)

| File | Lines | Replacement |
|---|---|---|
| `core/src/cdp.ts` | 195 | Extension uses `chrome.debugger` |
| `core/src/stream.ts` | 354 | Extension channels + LiveKit |
| `core/src/session.ts` | 307 | SDK polling only, no agent-side WS/CDP |
| `core/src/crypto.ts` | 81 | Rewrite with Web Crypto API |
| MCP CDP/streaming logic | ~150 | MCP becomes thin SDK client |

### What Core Becomes

```
core/
  src/
    crypto.ts             E2EE rewritten with Web Crypto API
    protocol.ts           Shared message types (session, input, detection)
    detection/
      index.ts            detectAuth(evaluate) → FormRelay | Viewport | PushRemind
      selectors.ts        CSS selectors for auth form detection
    channels/
      form-relay.ts       Field extraction + event schema
      viewport.ts         Screenshot request/response protocol
      push-remind.ts      Notification schema
    input.ts              Input event types + validation
```

Detection takes a generic `evaluate` function — no CDP coupling:
```ts
type Evaluate = (expression: string) => Promise<any>;
export async function detectAuth(evaluate: Evaluate): Promise<DetectedAuth>;
```

### What MCP Becomes

```ts
// Entire MCP implementation — no CDP, no WebSocket, no streaming
server.tool('authloop_to_human', schema, async ({ service, context }) => {
  const session = await authloop.toHuman({ service, context });
  return { sessionId: session.sessionId, sessionUrl: session.sessionUrl };
});

server.tool('authloop_status', {}, async () => {
  const result = await authloop.waitForResolution(activeSessionId);
  return { status: result.status };
});
```

## Session Flow (v2)

```
Agent (Claude Code / OpenClaw)
  │
  │  sdk.toHuman({ service, context })
  │  (no cdpUrl — removed from API)
  │
  ▼
AuthLoop API (platform)
  │
  ├─ Creates session in KV (PENDING)
  ├─ Logs to Neon
  ├─ Signals extension via Extension Relay DO
  │
  ▼
Chrome Extension (user's browser)
  │
  ├─ Receives session command via WSS
  ├─ Shows consent prompt: "OpenClaw wants to access HDFC NetBanking. Allow?"
  ├─ User approves → finds/opens target tab
  ├─ Runs detection (DOM heuristics via chrome.debugger)
  │
  ├─ Form Relay (80%): extracts fields → sends to viewer → human fills clean form
  ├─ Viewport (15%): tabCapture → LiveKit video → human interacts on video overlay
  └─ Push Remind (5%): notification only → human approves on their device
  │
  ├─ Human completes auth
  ├─ Extension detects completion → signals backend
  │
  ▼
Agent receives RESOLVED status → continues
```

## Security Audit Findings (must address)

### Blockers (Phase 1)

- [ ] **E2EE must use Web Crypto** — `node:crypto` won't run in extension
- [ ] **Device-scoped tokens** — extension gets narrow device token, not API key
- [ ] **Tokens out of query strings** — connect WSS unauthenticated, send token as first message
- [ ] **Per-session user consent** — extension prompts before activating
- [ ] **Minimal permissions** — use `activeTab` + dynamic requests, no `<all_urls>`
- [ ] **No global tab registry** — query `chrome.tabs.query()` per session instead
- [ ] **Input validation** — validate coordinates, key names, paste size before CDP dispatch
- [ ] **deviceId generated server-side** — prevent client-side spoofing

### High Priority (Phase 2)

- [ ] **CDP command allowlist** — never allow `Runtime.evaluate`, `Network.getCookies`, etc.
- [ ] **Rate limit input in extension** — 30/sec keystroke, 10/sec click
- [ ] **Replay protection** — monotonic counter in AES-GCM AAD
- [ ] **Scope LiveKit tokens** — subscriber: canPublish=false. Verify sender on data channel.
- [ ] **Multi-session support** — remove single-session global state

### Medium Priority (Phase 3+)

- [ ] **LiveKit E2EE for Viewport video** — SFU can see frames otherwise
- [ ] **Key pinning or SAS** — protect against active MITM by relay
- [ ] **Session metadata encryption at rest**
- [ ] **URL allowlist/blocklist** — user configures which domains extension can capture
- [ ] **Session audit log in extension** — local log viewable in popup

## API Contract Changes (platform repo)

### New Endpoints

```
POST   /extension/pair
  Request:  (requires Clerk session — dashboard only)
  Response: { code: string, expiresAt: string }

POST   /extension/confirm-pair
  Request:  { code: string }
  Response: { deviceId: string, accessToken: string, refreshToken: string }

POST   /extension/refresh
  Request:  { refreshToken: string, deviceId: string }
  Response: { accessToken: string }

DELETE /extension/device/:id
  Request:  (requires Clerk session)
  Response: { ok: true }

GET    /extension/ws
  → WSS upgrade (device accessToken as first message)
  → Receives: START_SESSION, STOP_SESSION
  → Sends:    SESSION_ACK, AUTH_COMPLETE, EXTENSION_ERROR

POST   /session/:id/livekit-token    (Phase 3)
  Request:  { role: 'publisher' | 'subscriber' | 'agent' }
  Response: { token: string, url: string, room: string }
```

### Changed Endpoints

```
POST   /session
  Request:  { service, context?, ttl? }      ← cdpUrl removed entirely
  Response: { session_id, session_url, capture, expires_at }
                                              ← stream_token, stream_url removed
                                              ← capture: always 'extension'
```

### New DB Table

```sql
CREATE TABLE devices (
  id           TEXT PRIMARY KEY,             -- nanoid(12)
  user_id      UUID NOT NULL REFERENCES users(id),
  name         TEXT NOT NULL,                -- "Chrome on MacBook Pro"
  token_hash   TEXT NOT NULL,                -- bcryptjs hash of refresh token
  last_seen_at TIMESTAMP WITH TIME ZONE,
  created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

### New Durable Object: ExtensionRelay

Replaces the current SessionRelay for extension-routed sessions.

- Maintains persistent WSS per paired device
- Routes session start/stop commands from API to extension
- Receives session acknowledgments and auth completion signals
- One DO instance per user (not per session)

## Implementation Phases

---

### Phase 0 — API Contract (~1 day)

All in platform repo. Design before code.

- [ ] Update OpenAPI spec with new/changed endpoints
- [ ] Write Drizzle migration for `devices` table
- [ ] Define WebSocket message types for ExtensionRelay DO
- [ ] Run codegen in authloop repo to generate updated types

**Deliverable:** Both repos have typed interfaces for everything that follows.

#### Test checkpoint

- [ ] OpenAPI spec serves at `GET /openapi.json` on local dev (`http://localhost:8787/openapi.json`)
- [ ] Codegen runs clean in authloop repo — `pnpm codegen:local` produces `types.generated.ts` with new endpoints
- [ ] `pnpm check-types` passes in both repos against the new types
- [ ] Drizzle migration applies to local Neon — `devices` table exists with correct columns
- [ ] ExtensionRelay message types are exported from core and importable in extension scaffold

---

### Phase 1 — Claude Code Works (~1 week)

Minimum viable: Claude Code can trigger auth handoff, user types in their own browser, agent gets notified.

No video. No detection. Just "focus tab + manual resolve."

#### Platform repo

- [x] DB: `devices` table migration
- [x] API: `POST /extension/pair` — dashboard generates 6-char code (5 min TTL)
- [x] API: `POST /extension/confirm-pair` — exchange code for device tokens
- [x] API: `POST /extension/refresh` — refresh access token
- [x] API: `DELETE /extension/device/:id` — revoke device
- [x] API: ExtensionRelay DO — persistent WSS per device, route session commands
- [x] API: `POST /session` — remove `cdpUrl` requirement, create session, signal ExtensionRelay
- [x] API: Update KV state machine — session routes signal ExtensionRelay DO directly
- [x] Web: Dashboard pairing page — generate code, show to user
- [x] Web: Device management UI — list paired devices, revoke
- [x] Web: Session viewer — simplified (no video, status page + resolve from extension)

#### AuthLoop repo (open-source)

- [x] SDK: Remove `cdpUrl` from `ToHumanOptions` entirely
- [x] SDK: Remove `streamToken`, `streamUrl` from `ToHumanResult`
- [x] SDK: Add `capture` field to response
- [x] Core: Delete `cdp.ts`, `stream.ts`, `session.ts` (entire agent-side engine)
- [x] Core: Rewrite `crypto.ts` with Web Crypto API
- [x] Core: Add `protocol.ts` — shared message types
- [x] Core: Add `input.ts` — input event types + validation in protocol.ts (INPUT_LIMITS)
- [x] Extension: Scaffold with WXT (MV3, TypeScript)
- [x] Extension: Popup UI — pairing form (enter 6-char code)
- [x] Extension: Token storage in `chrome.storage.local` + refresh via `chrome.alarms`
- [x] Extension: WSS to backend ExtensionRelay (persistent, reconnect with backoff)
- [x] Extension: Receive START_SESSION → show consent prompt (notification + popup)
- [x] Extension: User approves → find tab by URL (or open new tab) → focus
- [x] Extension: Show active session badge
- [x] Extension: Manual resolve button in popup → signal backend AUTH_COMPLETE
- [x] Extension: Session end → clear badge, notify backend
- [x] MCP: Rewrite — strip CDP/streaming, just `sdk.toHuman()` + `sdk.waitForResolution()`
- [x] MCP: Handle `extension_not_connected` with install/pairing instructions
- [x] OpenClaw plugin: Update to match new SDK API (remove cdpUrl references)

**Deliverable:** Claude Code calls `authloop_to_human` → user sees prompt in extension → focuses tab → types OTP → clicks resolve → Claude Code continues.

#### Test checkpoint

Unit tests (automated, run in CI) — **64 tests passing**:

- [x] SDK: `toHuman()` sends correct payload without `cdpUrl`, parses response with `capture` field (20 tests)
- [x] SDK: `waitForResolution()` polls and returns on terminal status
- [x] Core crypto: Web Crypto E2EE — generate keypair, derive secret, encrypt, decrypt roundtrip (7 tests)
- [x] Core crypto: Cross-environment — uses Web Crypto API (works in Node + browser)
- [x] Core protocol: message type serialization/deserialization (1 test)
- [x] Core input: validation rejects out-of-bounds coordinates, invalid keys, oversized paste (28 tests)
- [x] MCP: `authloop_to_human` returns session URL (mock SDK) (8 tests)
- [x] MCP: `authloop_status` returns status (mock SDK)
- [x] MCP: handles `extension_not_connected` error with guidance text

Integration tests (manual, against local dev):

- [x] **Pairing flow**: Open dashboard → generate code → enter in extension popup → extension shows "paired" state → device appears in dashboard device list
- [x] **Token refresh**: Tested via alarm cycle — extension refreshes token silently
- [x] **Device revoke**: Revoke device in dashboard → extension disconnects → shows pairing form
- [x] **Session creation**: Call `POST /session` with API key → KV entry created (PENDING) → ExtensionRelay receives START_SESSION
- [x] **Extension receives session**: Extension shows consent prompt with service name → user approves → tab focused → badge shows active
- [x] **Manual resolve**: Click resolve in extension popup → backend receives AUTH_COMPLETE → KV status = RESOLVED → `GET /session/:id` returns RESOLVED
- [ ] **Session timeout**: Create session, don't resolve → TTL expires → status = TIMEOUT → extension clears badge
- [ ] **Extension not connected**: Call `POST /session` when extension is offline → API returns `extension_not_connected` error → MCP shows install/pairing instructions
- [x] **End-to-end with MCP**: Configured MCP in Claude Desktop → triggered `authloop_to_human` → extension notified → clicked resolve → `authloop_status` returned resolved

---

### Phase 2 — LiveKit Video Streaming (~1 week)

Universal remote auth. Human sees the live browser tab and interacts with it directly. Works for everything — passwords, OTPs, CAPTCHAs, push MFA, any auth page.

```
Extension (user's Chrome)                  Web Viewer (session URL on phone/laptop)
├─ tabCapture → MediaStreamTrack           ├─ Subscribe to LiveKit room
├─ Offscreen doc → LiveKit video publish   ├─ Render <video> element
├─ chrome.debugger for input dispatch      ├─ Capture click/type/scroll on video overlay
├─ STREAM_META (CSS coords) broadcast      ├─ Coordinate mapping (CSS pixels, not video pixels)
└─ E2EE decrypt input → dispatch to page   └─ E2EE encrypt input → send via data channel
```

#### Platform repo

- [ ] API: LiveKit server SDK integration — room creation, token signing
- [ ] API: `POST /session/:id/livekit-token` — issue scoped tokens (publisher/subscriber)
- [ ] API: Store LiveKit credentials in Workers secrets (`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`)
- [ ] API: Update `POST /session` response — include `livekit_url` and `livekit_room` fields
- [ ] API: ExtensionRelay sends LiveKit publisher token to extension with `start_session`
- [ ] Web: Session viewer — replace status page with LiveKit video subscriber
- [ ] Web: Video overlay — capture click, type, scroll events on `<video>` element
- [ ] Web: E2EE key exchange in viewer (Web Crypto) + encrypt input via LiveKit data channel
- [ ] Web: Coordinate mapping — use STREAM_META (cssWidth/cssHeight), NOT video.videoWidth
- [ ] Web: Resolve/cancel buttons in viewer toolbar
- [ ] Web: Mobile-responsive viewer (pinch zoom, on-screen keyboard for mobile)

#### AuthLoop repo

- [ ] Extension: Add `offscreen` permission to manifest
- [ ] Extension: Offscreen document (`offscreen/index.ts`) — LiveKit SDK, getUserMedia, heartbeat
- [ ] Extension: Background gets `tabCapture.getMediaStreamId()` → sends stream ID to offscreen
- [ ] Extension: Offscreen creates LiveKit Room, publishes video track from tab capture
- [ ] Extension: Port-based communication (SW ↔ offscreen) — replaces message passing (more reliable)
- [ ] Extension: Heartbeat from offscreen → SW every 25s (keeps SW alive during streaming)
- [ ] Extension: STREAM_META broadcast via LiveKit data channel (cssWidth, cssHeight, pixelRatio)
- [ ] Extension: Tab resize → re-broadcast STREAM_META
- [ ] Extension: Track ended detection (tab closed/navigated) → notify backend
- [ ] Extension: Receive E2EE input from LiveKit data channel → decrypt → dispatch via `chrome.debugger`
- [ ] Extension: Add `debugger` permission to manifest (required for input dispatch)
- [ ] Extension: Lazy debugger attach/detach (attach on first input, auto-detach 3s after last)
- [ ] Extension: `chrome.debugger.onDetach` handler — resets state if Chrome forcibly detaches
- [ ] Extension: Rate limit input (30/sec keystroke, 10/sec click)
- [ ] Extension: Input validation (coordinates, key names, paste size) before dispatch
- [ ] Extension: CDP command allowlist — only allow Input.dispatch*, no Network/Storage/etc.
- [ ] Core: CDP allowlist module (`detection/cdp-allowlist.ts`)
- [ ] Core: STREAM_META type already in protocol.ts — verify it covers all fields

**Deliverable:** Agent creates session → extension captures tab → human opens session URL on phone → sees live browser → types password/solves CAPTCHA on video → input relayed to real page → auth resolves → agent continues.

#### Test checkpoint

Unit tests (automated):

- [ ] LiveKit token issuance: publisher token has `canPublish=true, canSubscribe=false`
- [ ] LiveKit token issuance: subscriber token has `canPublish=false, canSubscribe=true`
- [ ] STREAM_META: correctly computes cssWidth/cssHeight/pixelRatio
- [ ] CDP allowlist: `Input.dispatchKeyEvent` allowed, `Network.getCookies` blocked, `Storage.*` blocked
- [ ] CDP allowlist: `Runtime.evaluate` with `document.cookie` blocked, safe expressions allowed
- [ ] Input validation: rejects out-of-bounds coordinates, oversized paste, rate-limits

Integration tests (manual, against local dev):

- [ ] **Video publish**: Start session → extension captures tab → video track visible in LiveKit dashboard
- [ ] **Video subscribe**: Open session URL → `<video>` shows live browser tab content
- [ ] **Latency**: Move mouse on captured tab → visible in viewer within ~200ms
- [ ] **Click accuracy**: Click a button in viewer → correct button activates on real page
- [ ] **Coordinate mapping**: Click center of viewer → lands at center of tab (no Retina 2x offset)
- [ ] **Type in viewer**: Click text field in viewer → type on keyboard → characters appear in real field
- [ ] **Tab resize**: Resize captured tab → STREAM_META updates → viewer coordinates still accurate
- [ ] **Tab close**: Close captured tab → track ended → session errors gracefully
- [ ] **SW keepalive**: Session active for 2+ minutes without interaction → still alive (heartbeat)
- [ ] **E2EE roundtrip**: Viewer encrypts keystroke → extension decrypts → dispatches (relay sees only ciphertext)
- [ ] **Rate limiting**: Send 100 clicks in 1 second → extension drops excess, only ~10 dispatched
- [ ] **Mobile viewer**: Open session URL on phone → video renders, tap works, on-screen keyboard works
- [ ] **End-to-end**: Claude Code triggers auth → extension streams tab → user types on phone → auth completes → Claude Code continues

---

### Phase 3 — Detection + Optimizations (~1 week)

Optional enhancements on top of working video streaming. Not critical path.

#### Platform repo

- [ ] Web: Form Relay viewer — when extension detects parseable fields, show clean form instead of video
- [ ] Web: Push Remind viewer — just a notification message, no video/form needed

#### AuthLoop repo

- [ ] Core: `detection/index.ts` — DOM heuristic classifier (password/OTP → form_relay, captcha → viewport, push → push_remind)
- [ ] Core: `detection/selectors.ts` — CSS selectors for auth form detection
- [ ] Core: `channels/form-relay.ts` — field extraction + relay event schema
- [ ] Core: `channels/push-remind.ts` — notification-only schema
- [ ] Extension: Run detection on session start → classify auth type
- [ ] Extension: If form_relay: extract fields, send metadata to viewer, relay field input events
- [ ] Extension: If push_remind: just show notification, poll for completion
- [ ] Extension: Auto-resolve on navigation away from auth page
- [ ] Extension: Auto-resolve on DOM change (auth form disappears)
- [ ] OpenClaw plugin: Subscribe to LiveKit room (agent watches browser)

**Deliverable:** Password page → extension detects form → viewer shows clean native form instead of video (lower bandwidth, better UX). CAPTCHA → falls back to video. Push MFA → just a notification.

#### Test checkpoint

- [ ] Detection classifies password page as `form_relay`
- [ ] Detection classifies reCAPTCHA page as `viewport`
- [ ] Detection classifies push MFA as `push_remind`
- [ ] Form Relay: field extraction returns correct metadata for a login form
- [ ] Auto-resolve: navigation away from auth page triggers resolution
- [ ] Auto-resolve: OTP field disappearing triggers resolution
- [ ] End-to-end with Form Relay: viewer shows clean form, fill it, auth completes

---

### Phase 4 — Hardening + Mobile

- [ ] Replay protection — monotonic counter in AES-GCM AAD
- [ ] Key pinning / SAS for MITM protection on E2EE key exchange
- [ ] LiveKit E2EE for video frames (SFU can't see browser content)
- [ ] Session metadata encryption at rest (Neon)
- [ ] URL allowlist/blocklist in extension settings
- [ ] Session audit log in extension (local, viewable in popup)
- [ ] Multi-session support (remove single-session global state)
- [ ] `chrome.debugger` fallback — content script injection when debugger unavailable
- [ ] Session resumption after extension restart (`chrome.storage.session`)
- [ ] Mobile companion app (push notification → right UI per channel)

#### Test checkpoint

- [ ] Replay protection: replayed encrypted message (same counter) is rejected
- [ ] Key pinning: MITM with substituted pubkey is detected, session aborted
- [ ] LiveKit E2EE: video frames encrypted end-to-end (verify via LiveKit dashboard)
- [ ] URL blocklist: session targeting blocklisted domain → extension rejects
- [ ] Audit log: extension popup shows session history
- [ ] Multi-session: two concurrent sessions on different tabs work independently
- [ ] Extension restart: Chrome restarts mid-session → session resumes

---

## Development Workflow

```bash
# Platform (terminal 1+2)
cd /Users/gokul/Work/authloop/platform
pnpm --filter @authloop/api dev          # port 8787
pnpm --filter @authloop/web dev          # port 3000

# AuthLoop packages (terminal 3)
cd /Users/gokul/Work/authloop/authloop
pnpm dev

# Extension: load unpacked in Chrome
# chrome://extensions → Load unpacked → authloop/packages/extension/dist

# SDK codegen against local API
AUTHLOOP_OPENAPI_URL=http://localhost:8787/openapi.json pnpm codegen
```

## Key Principle

The extension is the product. Everything else is plumbing.

- SDK: thin HTTP client
- MCP: thin MCP wrapper around SDK
- Core: shared types + crypto + detection logic
- Backend: session state + relay + auth
- Web: dashboard + viewer UI

The extension is where capture, detection, input dispatch, LiveKit publishing, consent prompts, and completion detection all live. Get it right.
