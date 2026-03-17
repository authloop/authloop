# @authloop-ai/mcp

## 0.2.0

### Minor Changes

- 0bf90d3: Add @authloop-ai/core and @authloop-ai/openclaw-authloop packages. Two-tool flow: authloop_to_human (non-blocking, returns session URL) + authloop_status (blocks until resolved). Rename SDK method handoff() → toHuman(), class Authloop → AuthLoop. Breaking change for SDK consumers.

### Patch Changes

- Updated dependencies [0bf90d3]
  - @authloop-ai/sdk@0.2.0
  - @authloop-ai/core@0.2.0

## 0.1.1

### Patch Changes

- Make cdp_url optional with AUTHLOOP_CDP_URL env var fallback

  The `cdp_url` tool parameter is now optional. If not provided, the MCP server falls back to the `AUTHLOOP_CDP_URL` environment variable. Returns a clear error if neither is set.

- Updated dependencies []:
  - @authloop-ai/sdk@0.1.1

## 0.1.0

### Minor Changes

- Initial release — SDK HTTP client and MCP server with WebSocket streaming, E2EE for AuthLoop

### Patch Changes

- Updated dependencies []:
  - @authloop-ai/sdk@0.1.0
