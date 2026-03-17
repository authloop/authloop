---
"@authloop-ai/sdk": minor
"@authloop-ai/core": minor
"@authloop-ai/mcp": minor
"@authloop-ai/openclaw-authloop": minor
---

Add @authloop-ai/core and @authloop-ai/openclaw-authloop packages. Two-tool flow: authloop_to_human (non-blocking, returns session URL) + authloop_status (blocks until resolved). Rename SDK method handoff() → toHuman(), class Authloop → AuthLoop. Breaking change for SDK consumers.
