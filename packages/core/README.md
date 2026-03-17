# @authloop-ai/core

Core engine for [AuthLoop](https://authloop.ai) — CDP screencast, end-to-end encryption, and WebSocket relay.

This package powers the MCP server and OpenClaw plugin. You typically don't use it directly — use [`@authloop-ai/mcp`](../mcp) or [`@authloop-ai/openclaw-authloop`](../openclaw-plugin) instead.

## What it does

- **CDP client** — connects to a Chromium browser via Chrome DevTools Protocol, captures screencast frames (JPEG), dispatches keystrokes and input events
- **E2EE** — ECDH P-256 key exchange + AES-256-GCM encryption for all user input between the human's browser and the agent's machine
- **BrowserStream** — WebSocket relay that streams CDP frames to the human and relays encrypted input back to the browser
- **Session lifecycle** — creates sessions via the AuthLoop API, manages the PENDING → ACTIVE → RESOLVED state machine, handles cleanup on disconnect

## Exports

```ts
// Session management
export { startSession, waitForStatus, stopSession } from "./session.js";
export type { ToHumanInput, StartSessionOutput, SessionStatusOutput, SessionStatus };

// CDP screencast + input dispatch
export { BrowserStream } from "./stream.js";
export { CdpClient } from "./cdp.js";

// End-to-end encryption
export { E2EESession } from "./crypto.js";
```

## When to use this directly

Only if you're building a custom integration that isn't covered by the MCP server, OpenClaw plugin, or SDK. For example:

- A custom agent runtime that needs direct control over the screencast stream
- A browser extension that manages its own CDP connection
- A relay server with custom transport (e.g., WebRTC instead of WebSocket)

For most use cases, use the higher-level packages instead.

## License

MIT
