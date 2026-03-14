# Implementation Tasks

## Package: @authloop/sdk ✅ (Skeleton complete)

The SDK is a thin HTTP client. Core implementation is done in `packages/sdk/src/index.ts`:
- `Authloop` class with `handoff()`, `getSession()`, `cancelSession()`, `resolveSession()`, `waitForResolution()`
- `AuthloopError` class with status code and error code
- Camel case public API, snake_case wire format (matches API)

### Remaining SDK tasks
- [ ] Run codegen to generate `types.generated.ts` from production OpenAPI spec
- [ ] Add `types.ts` with hand-written wrappers if generated types need adaptation
- [ ] Add unit tests (mock fetch, verify request/response mapping)
- [ ] Add README.md with usage examples
- [ ] Publish to npm as `@authloop/sdk`

---

## Package: @authloop/mcp 🔧 (Needs implementation)

The MCP server is the primary integration point for OpenClaw users. It runs as a subprocess over stdio.

### Architecture

```
OpenClaw launches @authloop/mcp as MCP subprocess
  ↓
MCP server registers `authloop_handoff` tool
  ↓
Agent calls authloop_handoff when it hits an auth wall
  ↓
MCP server:
  1. Calls POST /session via @authloop/sdk → gets { session_url, stream_token }
  2. Returns session_url to the agent (agent sends it to the human)
  3. Polls GET /session/:id until ACTIVE
  4. Joins the streaming room using stream_token
  5. Captures CDP screencast frames and publishes them as video
  6. Receives keystrokes from the human via data channel
  7. Dispatches keystrokes to the browser via CDP Input.dispatchKeyEvent
  8. On login completion: calls POST /session/:id/resolve, then disconnects
  9. Returns success to the agent
```

### MCP Implementation Tasks

#### 1. MCP Server Setup
- [ ] Implement MCP server using `@modelcontextprotocol/sdk`
- [ ] Register `authloop_handoff` tool with schema:
  ```
  Input: { service: string, cdp_url: string, context?: { url?, blocker_type?, hint? } }
  Output: { session_url: string, status: "resolved" | "error" | "timeout" }
  ```
- [ ] Read `AUTHLOOP_API_KEY` and `AUTHLOOP_BASE_URL` from environment
- [ ] Create `@authloop/sdk` client instance on startup

#### 2. Session Management (`src/session.ts`)
- [ ] Call `authloop.handoff()` to create session
- [ ] Return `session_url` to the agent immediately (agent notifies the human)
- [ ] Poll `authloop.getSession()` every 3s until ACTIVE or terminal
- [ ] Handle TIMEOUT and ERROR states gracefully
- [ ] On ACTIVE: start streaming (see step 3)

#### 3. Browser Streaming (`src/stream.ts`)
- [ ] Connect to streaming room using stream token and `@livekit/rtc-node`
- [ ] Start CDP screencast via `Page.startScreencast` on the cdp_url
- [ ] Convert CDP screencast frames (JPEG) to video track
- [ ] Publish video track to the room
- [ ] Subscribe to data channel for incoming keystrokes from the human

#### 4. Keystroke Dispatch
- [ ] Parse keystroke messages from data channel: `{ type: "keydown"|"keypress", key: string }`
- [ ] For `keypress`: dispatch `Input.dispatchKeyEvent` with type `keyDown` + `char` + `keyUp`
- [ ] For `keydown` (special keys): dispatch `Input.dispatchKeyEvent` for Enter, Tab, Backspace, etc.
- [ ] Handle modifier keys if needed (Shift, Ctrl)

#### 5. Clean Disconnect Protocol
- [ ] On successful login detection (or agent request):
  1. Send `{ type: "resolved" }` via data channel to notify human's browser
  2. Call `POST /session/:id/resolve` to set explicit_resolve flag
  3. Disconnect from room
  4. Return success to agent
- [ ] On error/crash: room disconnect without resolve → API sets ERROR status via webhook

#### 6. Error Handling
- [ ] Handle CDP connection failures
- [ ] Handle streaming room connection failures
- [ ] Handle API errors (401, 402, 429)
- [ ] Timeout handling (session TTL expiry)
- [ ] Graceful shutdown on SIGTERM/SIGINT

### Testing
- [ ] Unit tests for session management logic
- [ ] Integration test: create session → poll → verify status
- [ ] Manual test with OpenClaw against a real auth wall

### Publishing
- [ ] Add README.md with OpenClaw config example
- [ ] Publish to npm as `@authloop/mcp`
- [ ] Submit to OpenClaw MCP registry

---

## CI/CD Tasks
- [ ] GitHub Action: on push to main, regenerate types from production spec
- [ ] Fail CI if `types.generated.ts` changed without being committed
- [ ] Auto-publish to npm on version tag
