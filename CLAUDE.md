# AuthLoop — Open Source SDK & MCP Server

Open source packages for integrating AuthLoop into AI agents. When an agent hits an authentication wall (OTP, captcha, password), it calls AuthLoop to hand off to a human who resolves it in seconds.

**License:** MIT

## Repo Structure

```
packages/
  sdk/    → @authloop-ai/sdk — TypeScript SDK for any agent/runtime
  mcp/    → @authloop-ai/mcp — MCP server for OpenClaw and compatible agents
```

This is a **public** repo. The AuthLoop API server and web app live in a separate private repo. These packages communicate with the API via REST only — they never share code with the server.

## How It Works

1. Agent hits an auth wall (OTP, captcha, password prompt)
2. Agent calls `authloop.handoff()` (SDK) or uses `authloop_handoff` tool (MCP)
3. AuthLoop API creates a session, returns a `session_url` + `stream_token`
4. Agent sends `session_url` to the human (via Telegram, Slack, WhatsApp, etc.)
5. Agent publishes browser frames to the session using the stream token
6. Human opens the URL, sees the live browser tab, types the OTP/password
7. Agent calls `resolveSession()` and continues

## Packages

### @authloop-ai/sdk

TypeScript HTTP client wrapping the AuthLoop REST API.

```ts
import { AuthLoop } from '@authloop-ai/sdk';

const auth = new AuthLoop({ apiKey: 'al_live_...' });
const session = await auth.handoff({
  service: 'HDFC NetBanking',
  cdpUrl: 'ws://localhost:9222',
  context: { blockerType: 'otp', hint: 'OTP sent to ****1234' }
});

// Send session.sessionUrl to the human via notification
// Publish browser frames using session.streamToken
// Poll or wait for resolution:
const result = await auth.waitForResolution(session.sessionId);
```

### @authloop-ai/mcp

MCP server that exposes `authloop_handoff` as a tool. One line in `openclaw.json`:

```json
{
  "mcp": {
    "servers": {
      "authloop": {
        "command": "npx",
        "args": ["-y", "@authloop-ai/mcp"],
        "env": { "AUTHLOOP_API_KEY": "al_live_..." }
      }
    }
  }
}
```

The MCP server handles:
- Session creation via `authloop_handoff` tool
- Publishing CDP screencast frames to the session stream
- Receiving keystrokes from the human and dispatching to the browser via CDP
- Clean disconnect protocol (resolve → disconnect)
- Error handling on unexpected disconnects

## API Contract

The SDK and MCP server communicate with the AuthLoop API at `https://api.authloop.ai`. All agent-facing endpoints require `Authorization: Bearer {api_key}`.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /session | Create a handoff session |
| GET | /session/:id | Poll session status |
| DELETE | /session/:id | Cancel a session |
| POST | /session/:id/resolve | Mark as resolved before disconnect |

### POST /session

```
Request:  { service, cdp_url, ttl?, context?: { url?, blocker_type?, hint? } }
Response: { session_id, session_url, stream_token, expires_at }
```

### GET /session/:id

```
Response: { session_id, status, service, context?, created_at, expires_at }
Status:   PENDING | ACTIVE | RESOLVED | TIMEOUT | ERROR
```

### Session Lifecycle

```
PENDING  → human hasn't joined yet (agent polls every 3s)
ACTIVE   → human connected, stream is live
RESOLVED → auth completed, agent should continue
TIMEOUT  → session expired (TTL elapsed, default 10 min)
ERROR    → unexpected failure (agent crashed, etc.)
```

### Error Codes

| Status | Meaning |
|--------|---------|
| 400 | Invalid request body |
| 401 | Invalid or missing API key |
| 402 | Quota exceeded |
| 403 | Session belongs to a different API key |
| 404 | Session not found |
| 409 | Session already resolved |
| 410 | Session expired |
| 429 | Rate limited |

## Type Generation

Types are generated from the OpenAPI spec served by the AuthLoop API:

```bash
# From production API
pnpm codegen

# From local dev API (running on port 8787)
pnpm --filter @authloop-ai/sdk codegen:local
pnpm --filter @authloop-ai/mcp codegen:local
```

This fetches `/openapi.json` and generates `src/types.generated.ts` in each package. Never edit these files manually.

## Environment Variables

### @authloop-ai/mcp (set by developer)
```bash
AUTHLOOP_API_KEY=al_live_...           # Required — API key from authloop.ai/dashboard
AUTHLOOP_BASE_URL=https://api.authloop.ai  # Optional — override for local dev
```

### Codegen only (dev-time)
```bash
AUTHLOOP_OPENAPI_URL=https://api.authloop.ai/openapi.json  # Default
# Local: AUTHLOOP_OPENAPI_URL=http://localhost:8787/openapi.json
```

## Commands

```bash
pnpm install              # Install all dependencies
pnpm build                # Build all packages
pnpm check-types          # Type-check all packages
pnpm test                 # Run all tests
pnpm codegen              # Regenerate types from OpenAPI spec
pnpm changeset            # Create a changeset for your changes
pnpm version-packages     # Apply changesets: bump versions + update changelogs
pnpm release              # Build, test, and publish to npm
```

## Development

1. Get an API key from `https://authloop.ai/dashboard/api-keys`
2. Set `AUTHLOOP_API_KEY` in your environment
3. For local development against the API, set `AUTHLOOP_BASE_URL=http://localhost:8787`

## Commit Rules

- No AI attribution in commits
- Keep commits focused and descriptive

## Publishing

This repo uses [changesets](https://github.com/changesets/changesets) for versioning and publishing. Both packages are published to npm under the `@authloop-ai` scope with `"fixed"` versioning (they always share the same version number).

### How to release a new version

1. **Add a changeset** — run `pnpm changeset` and follow the prompts. Pick the affected packages, choose a semver bump (patch/minor/major), and write a summary. This creates a markdown file in `.changeset/`.
2. **Commit and push** — include the changeset file in your PR. CI will pass as normal.
3. **Merge to main** — the `changesets/action` GitHub Action detects pending changesets and opens a "Version Packages" PR. This PR bumps versions in `package.json`, updates `CHANGELOG.md` in each package, and consumes the changeset files.
4. **Merge the Version Packages PR** — this triggers the action again, which runs `pnpm release` (build → test → `changeset publish`) and publishes both packages to npm.

### Manual release (if needed)

```bash
pnpm changeset          # create a changeset
pnpm version-packages   # bump versions + update changelogs
pnpm release            # build, test, publish to npm
```

### Required secrets

- `NPM_TOKEN` — npm access token with publish permission for `@authloop-ai` scope. Set in GitHub repo Settings → Secrets.
