# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-03-14

### Added

- `@authloop-ai/sdk` — TypeScript HTTP client for the AuthLoop API
  - `Authloop` class with `handoff()`, `getSession()`, `cancelSession()`, `resolveSession()`, `waitForResolution()`
  - `AuthloopError` with status code and error code
  - Full camelCase public API with snake_case wire format
- `@authloop-ai/mcp` — MCP server exposing `authloop_handoff` tool
  - CDP WebSocket client for browser screencast capture
  - LiveKit video bridge for streaming browser frames to humans
  - Keystroke dispatch from human back to browser via CDP
  - Session lifecycle management (create → poll → stream → resolve)
  - Graceful shutdown on SIGINT/SIGTERM
- Unit tests for SDK, CDP client, and session logic (32 tests)
