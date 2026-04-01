# AuthLoop v2 — Architecture & Implementation Plan

## What AuthLoop Is

When an AI agent hits an auth wall (OTP, captcha, password), it calls AuthLoop. A human gets notified, sees the live browser on their phone, types the password, and the agent continues. No stored credentials, no cloud browsers.

## Target Users

| User | Browser | CDP access | How they use AuthLoop |
|---|---|---|---|
| **OpenClaw (Mac Mini automation)** | OpenClaw's browser | Yes | OpenClaw plugin, passes cdpUrl |
| **Claude Desktop + Chrome MCP** | Chrome (via DevTools MCP) | Yes | AuthLoop MCP, receives cdpUrl from Chrome MCP |
| **Playwright/Puppeteer developers** | Their own browser | Yes | `@authloop-ai/playwright` or `@authloop-ai/puppeteer` plugin |

All users already have CDP access. AuthLoop plugs in — no extension, no extra browser, no setup beyond an API key.

## Architecture

```
Agent (OpenClaw / Claude / Playwright / Puppeteer)
  │
  │  Has a browser with CDP access
  │  Calls authloop with cdp_url
  │
  ▼
AuthLoop Core (runs in agent's process)
  ├─ Connect to browser via CDP WebSocket
  ├─ Start Page.startScreencast → JPEG frames (quality 85, native resolution)
  ├─ Stream frames to WebSocket relay (platform DO)
  ├─ E2EE key exchange with viewer (ECDH P-256 + AES-256-GCM, Web Crypto)
  ├─ Receive encrypted input → dispatch via CDP (Input.dispatchKeyEvent, etc.)
  └─ Detect resolution → cleanup
  │
  ▼
AuthLoop API (platform)
  ├─ Session creation + status polling
  ├─ WebSocket relay (Durable Object) — relays frames + input between agent and viewer
  └─ Session lifecycle (PENDING → ACTIVE → RESOLVED/TIMEOUT/CANCELLED)
  │
  ▼
Web Viewer (user's phone / any browser)
  ├─ Opens session URL
  ├─ Sees live browser on canvas (JPEG frames via WebSocket)
  ├─ Types password / solves CAPTCHA
  ├─ Input encrypted (E2EE) → relayed to agent → dispatched via CDP
  └─ Clicks resolve → session done → agent continues
```

## Package Architecture

```
authloop/ (open-source)                    platform/ (private)
├── packages/                              ├── apps/
│   ├── sdk/           HTTP client         │   ├── api/          Hono + CF Workers
│   ├── core/          CDP + E2EE +        │   │   ├── routes/   REST + WebSocket
│   │                  screencast +         │   │   ├── relay.ts  session relay DO
│   │                  input dispatch       │   │   └── lib/      KV, auth helpers
│   ├── mcp/           MCP server          │   └── web/          Next.js
│   ├── playwright/    Playwright plugin   │       ├── session/   Live viewer (canvas)
│   ├── puppeteer/     Puppeteer plugin    │       └── dashboard/ API keys, sessions
│   └── openclaw-plugin/                   └── packages/
│                                              └── db/           Drizzle schema
│   (paused)
│   └── extension/     Chrome extension (Phase 4)
```

## What's Built (current state)

### Working

- **SDK**: HTTP client, `toHuman()`, `waitForResolution()`, 20 tests passing
- **Core**: Web Crypto E2EE, protocol types, input validation, CDP allowlist, detection heuristics. 36+ tests passing. CDP engine needs to be restored from git.
- **MCP**: Thin SDK client, 8 tests passing. Needs CDP/streaming re-added.
- **OpenClaw plugin**: Updated to v2 SDK API. Needs core restored.
- **Platform API**: Session creation, WebSocket relay DO, API keys (soft delete), LiveKit token issuance
- **Platform Web**: Dashboard (API keys, sessions, devices), session viewer (LiveKit + canvas fallback)

### Paused

- **Extension**: Full MV3 Chrome extension with WXT, LiveKit streaming, pairing flow. Paused because `tabCapture` requires user gesture every session — defeats the purpose of remote auth. Will revisit in Phase 4 for "share my existing tab" niche.

### Needs Restoration

- **Core CDP engine**: `cdp.ts` (CDP WebSocket client), `stream.ts` (screencast + input dispatch), `session.ts` (session lifecycle). Deleted during extension pivot, need to restore from git with v2 improvements (Web Crypto E2EE, input validation, CDP allowlist, higher quality settings).

## Implementation Plan

---

### Phase 2 — CDP Streaming (current priority)

Restore the CDP engine, update MCP with `cdp_url`, build Playwright/Puppeteer plugins. This gives all three user segments a working product.

#### Step 1: Restore Core CDP Engine (~1 day)

Restore from git, apply v2 improvements:

- [ ] `core/src/cdp.ts` — CDP WebSocket client (restore from git commit b467f5e)
- [ ] `core/src/stream.ts` — BrowserStream with screencast + input dispatch (restore from git)
- [ ] `core/src/session.ts` — session lifecycle: startSession, waitForStatus, stopSession (restore from git)
- [ ] Apply v2 improvements to restored files:
  - [ ] Use Web Crypto E2EE (already built) instead of node:crypto E2EE
  - [ ] Add input validation before CDP dispatch (already built in input.ts)
  - [ ] Add CDP allowlist checks (already built in detection/cdp-allowlist.ts)
  - [ ] Increase screencast quality: quality 85 (was 60), maxWidth/maxHeight at CSS resolution (was 1280x720)
  - [ ] Keep everyNthFrame: 1 for smooth streaming
- [ ] Update `core/src/index.ts` — re-export CdpClient, BrowserStream, startSession, waitForStatus, stopSession
- [ ] Restore and update core tests

#### Step 2: Update SDK (~half day)

- [ ] Add `cdpUrl` back to `ToHumanOptions` (required field)
- [ ] Add `streamToken` and `streamUrl` back to `ToHumanResult`
- [ ] Update SDK tests
- [ ] Run codegen from platform API (update types.generated.ts)

#### Step 3: Update Platform API (~half day)

- [ ] Restore `SessionRelay` DO for WebSocket frame relay (was deleted, restore from git)
- [ ] Update `POST /session` — require `cdp_url` again, generate stream tokens, return `stream_url`
- [ ] Update OpenAPI spec to match
- [ ] Keep the extension relay DO and endpoints (for Phase 4)

#### Step 4: Update Platform Web Viewer (~half day)

- [ ] Restore WebSocket + canvas viewer (`use-stream.ts`, `session-stream.tsx` from git)
- [ ] Apply Web Crypto E2EE in viewer (replace node:crypto implementation)
- [ ] Keep LiveKit viewer component (for Phase 4 extension path)

#### Step 5: Update MCP (~half day)

- [ ] Add `cdp_url` parameter back to `authloop_to_human`
- [ ] MCP calls core `startSession()` which handles CDP connect, screencast, input relay
- [ ] MCP calls `waitForStatus()` which blocks until resolved
- [ ] Handle `AUTHLOOP_CDP_URL` env var as default

#### Step 6: Update OpenClaw Plugin (~half day)

- [ ] Use restored core `startSession` / `waitForStatus` / `stopSession`
- [ ] Pass cdpUrl from OpenClaw's browser

#### Step 7: Build Playwright Plugin (~1 day)

Create `packages/playwright/`:

```ts
// @authloop-ai/playwright
import { AuthLoop } from '@authloop-ai/sdk';
import { startSession, waitForStatus, stopSession } from '@authloop-ai/core';

export function withAuthLoop(page, options: { apiKey: string; baseUrl?: string }) {
  const authloop = new AuthLoop(options);

  // Get CDP endpoint from Playwright's browser
  const cdpUrl = page.context().browser()?.wsEndpoint();

  // Return a proxy that intercepts navigation and detects auth walls
  // Or expose a manual toHuman() method
  return {
    ...page,
    async toHuman(service: string, context?) {
      const session = await startSession(authloop, { service, cdpUrl, context });
      console.log(`Auth needed: ${session.sessionUrl}`);
      const result = await waitForStatus();
      await stopSession();
      return result;
    }
  };
}
```

#### Step 8: Build Puppeteer Plugin (~half day, same pattern)

#### Step 9: Test End-to-End (~1 day)

**Test checkpoint:**

Unit tests (automated):
- [ ] Core CDP: connect, send command, receive event, disconnect
- [ ] Core stream: screencast frames sent to WebSocket, input dispatched to CDP
- [ ] Core session: startSession → waitForStatus → stopSession lifecycle
- [ ] Core E2EE: encrypt/decrypt roundtrip (already passing, 7 tests)
- [ ] Core input validation: coordinates, key names, paste size (already passing, 28 tests)
- [ ] SDK: toHuman with cdpUrl, response with streamToken/streamUrl
- [ ] MCP: authloop_to_human with cdp_url, authloop_status returns resolved

Integration tests (manual):
- [ ] **Playwright**: script navigates to login page → calls toHuman → user sees browser on phone → types password → script continues
- [ ] **MCP + Claude Desktop**: Claude calls authloop_to_human with cdpUrl from Chrome MCP → user sees browser → types → Claude continues
- [ ] **OpenClaw**: agent hits auth → plugin creates session → user resolves → agent continues
- [ ] **Quality check**: text on auth page is readable in viewer at native resolution
- [ ] **E2EE**: verify relay logs show only ciphertext, no plaintext input
- [ ] **Mobile viewer**: open session URL on phone, tap works, typing works

---

### Phase 3 — Detection + Optimizations

Optional enhancements on top of working CDP streaming.

- [ ] DOM heuristic detection (already built in core, needs integration)
- [ ] Form Relay: extract fields → clean form instead of video
- [ ] Auto-resolve on navigation / DOM change
- [ ] Push Remind: notification-only for push MFA

---

### Phase 4 — Extension + Mobile

For the "share my existing tab" niche and mobile companion app.

- [ ] Chrome extension with tabCapture (one-click consent per session)
- [ ] Extension pairing flow (already built)
- [ ] LiveKit streaming from extension (already built)
- [ ] Mobile companion app

---

### Phase 5 — Hardening

- [ ] Replay protection (monotonic counter in AES-GCM AAD)
- [ ] Key pinning / SAS for MITM protection
- [ ] Session metadata encryption at rest
- [ ] Multi-session support
- [ ] Rate limiting in viewer

---

## Development Setup

```bash
# Platform
cd /Users/gokul/Work/authloop/platform
pnpm --filter @authloop/api dev     # port 8787
pnpm --filter @authloop/web dev     # port 3000

# AuthLoop packages
cd /Users/gokul/Work/authloop/authloop
pnpm dev

# Codegen (after API changes)
AUTHLOOP_OPENAPI_URL=http://localhost:8787/openapi.json pnpm --filter @authloop-ai/sdk codegen
```

## Key Principle

Meet users where they are. Every target user already has a browser with CDP. AuthLoop plugs into it with one install + API key. No extension, no pairing, no popup clicks.
