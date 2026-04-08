# @authloop-ai/sdk

## 0.3.0

### Minor Changes

- d639d11: v0.3.0 — CDP-first architecture, E2EE, and autonomous MCP

  **Core**

  - End-to-end encrypted input channel between viewer and agent (ECDH P-256 + AES-256-GCM via Web Crypto)
  - CDP screencast with viewport auto-detection, quality presets (low/medium/high, default high), and focus emulation to defeat background-tab throttling
  - Input validation for click, keydown, paste, and scroll events
  - Session protocol types shared with relay
  - Cancel session on agent disconnect so the API doesn't leave sessions stuck ACTIVE

  **MCP**

  - Upgrade `@modelcontextprotocol/sdk` to 1.29.0
  - Adopt structured output (`outputSchema` + `structuredContent`) on both tools
  - Add server-level `instructions` so the model knows when to invoke AuthLoop without per-tool prompting
  - Progress notifications (15s heartbeat) and client-cancellation support on `authloop_status`
  - Defensive 11-minute timeout on `authloop_status` so the tool always returns even if the wait wedges
  - Stronger tool descriptions covering trigger conditions and required call ordering
  - Surface "session already in progress" as an actionable error

  **SDK / OpenClaw plugin**

  - Minor cleanup aligned with the new core protocol

## 0.2.2

## 0.2.1

## 0.2.0

### Minor Changes

- 0bf90d3: Add @authloop-ai/core and @authloop-ai/openclaw-authloop packages. Two-tool flow: authloop_to_human (non-blocking, returns session URL) + authloop_status (blocks until resolved). Rename SDK method handoff() → toHuman(), class Authloop → AuthLoop. Breaking change for SDK consumers.

## 0.1.1

## 0.1.0

### Minor Changes

- Initial release — SDK HTTP client and MCP server with WebSocket streaming, E2EE for AuthLoop
