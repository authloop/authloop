# Implementation Tasks

## Package: @authloop-ai/sdk ✅

The SDK is a thin HTTP client. Implementation is in `packages/sdk/src/index.ts`:
- `Authloop` class with `handoff()`, `getSession()`, `cancelSession()`, `resolveSession()`, `waitForResolution()`
- `AuthloopError` class with status code and error code
- Camel case public API, snake_case wire format (matches API)

### SDK tasks
- [x] Core implementation (all methods)
- [x] `livekitUrl` field in `HandoffResult`
- [x] Unit tests (17 tests — mock fetch, request/response mapping, error handling, polling)
- [x] README.md with install, usage, full API reference
- [x] package.json metadata (description, author, repo, keywords, publishConfig)
- [ ] Run codegen to generate `types.generated.ts` from production OpenAPI spec
- [ ] Add `types.ts` with hand-written wrappers if generated types need adaptation
- [ ] Integration test against real API

---

## Package: @authloop-ai/mcp ✅

The MCP server is the primary integration point. Runs as a subprocess over stdio.

### Architecture

```
Agent calls authloop_handoff tool via MCP
  ↓
MCP server (src/index.ts):
  1. Validates AUTHLOOP_API_KEY, creates SDK client
  2. Registers authloop_handoff tool with Zod schema
  3. Connects via StdioServerTransport
  ↓
Session lifecycle (src/session.ts):
  1. Calls POST /session via SDK → gets session_url, stream_token, livekit_url
  2. Polls GET /session/:id every 3s until ACTIVE or terminal
  3. All 5 states handled: PENDING (poll), ACTIVE (stream), RESOLVED/TIMEOUT/ERROR (return)
  ↓
Browser streaming (src/stream.ts + src/cdp.ts):
  1. CDP WebSocket client connects to browser
  2. Starts Page.screencastFrame → decode JPEG → RGBA VideoFrame → LiveKit publish
  3. Receives keystrokes via LiveKit dataReceived → CDP Input.dispatchKeyEvent
  4. Waits for { type: "resolved" } message → resolves session → disconnects
```

### MCP tasks
- [x] MCP server setup with `@modelcontextprotocol/sdk`
- [x] `authloop_handoff` tool registration with Zod input schema
- [x] Environment validation (AUTHLOOP_API_KEY required, AUTHLOOP_BASE_URL optional)
- [x] Session lifecycle: create → poll → stream → resolve
- [x] All poll states handled correctly (PENDING/ACTIVE/RESOLVED/TIMEOUT/ERROR)
- [x] CDP WebSocket client (`src/cdp.ts`) with command tracking + event dispatch
- [x] LiveKit video bridge (`src/stream.ts`) — screencast → JPEG decode → VideoFrame
- [x] Keystroke dispatch from human → CDP Input.dispatchKeyEvent
- [x] Resolution detection via LiveKit data channel
- [x] Clean disconnect protocol (resolve → stop stream → disconnect)
- [x] Graceful shutdown on SIGINT/SIGTERM
- [x] Concurrency guard (reject second handoff while one is active)
- [x] Unit tests — CDP client (8 tests), session logic (8 tests)
- [x] README.md with MCP config example + tool schema
- [x] package.json metadata + publishConfig
- [ ] Integration test: real API + browser with CDP
- [ ] Manual test with Claude Desktop / OpenClaw against a real auth wall

---

## Repo & Publishing ✅

- [x] MIT LICENSE file
- [x] Root README with quick start, contributing link
- [x] CONTRIBUTING.md with dev setup, changeset instructions
- [x] CODE_OF_CONDUCT.md (Contributor Covenant)
- [x] Changesets for versioning (`@changesets/cli` + `@changesets/changelog-github`)
- [x] Fixed versioning (SDK + MCP always share version number)
- [x] GitHub Actions CI — build + typecheck + test on Node 18/20/22
- [x] GitHub Actions Release — changesets/action for automated publish
- [x] `pnpm changeset` / `pnpm version-packages` / `pnpm release` scripts

---

## Remaining work

### Before first publish
- [ ] Run codegen against production API (`pnpm codegen`) — needs API serving `/openapi.json`
- [ ] Integration test with real AuthLoop API
- [ ] Manual E2E test: agent → MCP → API → human resolves → agent continues
- [ ] Set `NPM_TOKEN` secret in GitHub repo settings
- [ ] Create first changeset and publish v0.1.0

### Future
- [ ] GitHub Action: regenerate types on push to main, fail CI if types drifted
- [ ] Submit to MCP server registries (Claude Desktop, OpenClaw)
- [ ] Add timeout handling during streaming (session TTL expiry while stream is active)
- [ ] Reconnect logic if LiveKit connection drops mid-stream
