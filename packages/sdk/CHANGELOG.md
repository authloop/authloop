# @authloop-ai/sdk

## 0.2.1

## 0.2.0

### Minor Changes

- 0bf90d3: Add @authloop-ai/core and @authloop-ai/openclaw-authloop packages. Two-tool flow: authloop_to_human (non-blocking, returns session URL) + authloop_status (blocks until resolved). Rename SDK method handoff() → toHuman(), class Authloop → AuthLoop. Breaking change for SDK consumers.

## 0.1.1

## 0.1.0

### Minor Changes

- Initial release — SDK HTTP client and MCP server with WebSocket streaming, E2EE for AuthLoop
