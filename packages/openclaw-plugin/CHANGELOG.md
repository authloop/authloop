# @authloop-ai/openclaw-authloop

## 0.2.2

### Patch Changes

- 916597c: Add server TTL-based timeout to waitForStatus so it never blocks forever. Replace QR ASCII generation with display hints — agent/channel handles QR rendering natively. Remove qrcode dependency.
- Updated dependencies [916597c]
  - @authloop-ai/core@0.2.2
  - @authloop-ai/sdk@0.2.2

## 0.2.1

### Patch Changes

- 46aabe8: Add ASCII QR code and display hints to authloop_to_human tool response. Improved plugin setup error message with step-by-step instructions.
  - @authloop-ai/sdk@0.2.1
  - @authloop-ai/core@0.2.1

## 0.2.0

### Minor Changes

- 0bf90d3: Add @authloop-ai/core and @authloop-ai/openclaw-authloop packages. Two-tool flow: authloop_to_human (non-blocking, returns session URL) + authloop_status (blocks until resolved). Rename SDK method handoff() → toHuman(), class Authloop → AuthLoop. Breaking change for SDK consumers.

### Patch Changes

- Updated dependencies [0bf90d3]
  - @authloop-ai/sdk@0.2.0
  - @authloop-ai/core@0.2.0
