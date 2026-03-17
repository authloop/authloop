# @authloop-ai/sdk

TypeScript SDK for [AuthLoop](https://authloop.ai) — human-in-the-loop authentication for AI agents.

When your agent hits an OTP, captcha, or password wall, call `authloop.toHuman()` to let a human resolve it in seconds.

## Install

```bash
npm install @authloop-ai/sdk
```

## Usage

```ts
import { AuthLoop } from '@authloop-ai/sdk';

const authloop = new AuthLoop({ apiKey: 'al_live_...' });

// When your agent hits an auth wall:
const session = await authloop.toHuman({
  service: 'HDFC NetBanking',
  cdpUrl: 'ws://localhost:9222',
  context: { blockerType: 'otp', hint: 'OTP sent to ****1234' }
});

// Send session.sessionUrl to the human (Telegram, Slack, etc.)

// Wait for the human to resolve it:
const result = await authloop.waitForResolution(session.sessionId);
// result.status === 'RESOLVED' → agent continues
```

## API

### `new AuthLoop(config)`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `apiKey` | `string` | Yes | API key from [authloop.ai/dashboard](https://authloop.ai/dashboard/api-keys) |
| `baseUrl` | `string` | No | Override API base URL (default: `https://api.authloop.ai`) |

### `authloop.toHuman(options)`

Creates a session and loops the auth to a human. Returns `{ sessionId, sessionUrl, streamToken, streamUrl, expiresAt }`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `service` | `string` | Yes | Name of the service (e.g. `'HDFC NetBanking'`) |
| `cdpUrl` | `string` | Yes | CDP endpoint — HTTP or WebSocket URL. HTTP endpoints are auto-resolved via `/json`. |
| `ttl` | `number` | No | Session timeout in seconds |
| `context.url` | `string` | No | Current page URL |
| `context.blockerType` | `string` | No | `'otp'`, `'password'`, `'captcha'`, `'security_question'`, `'document_upload'`, `'other'` |
| `context.hint` | `string` | No | Hint for the human (e.g. `'OTP sent to ****1234'`) |

### `authloop.getSession(sessionId)`

Returns current session status: `PENDING`, `ACTIVE`, `RESOLVED`, `TIMEOUT`, `ERROR`, or `CANCELLED`.

### `authloop.resolveSession(sessionId)`

Marks a session as resolved.

### `authloop.cancelSession(sessionId)`

Cancels a session.

### `authloop.waitForResolution(sessionId, options?)`

Polls until the session reaches a terminal state (`RESOLVED`, `TIMEOUT`, `ERROR`, or `CANCELLED`). Returns the final `SessionStatus`.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `pollInterval` | `number` | `3000` | Polling interval in ms |
| `timeout` | `number` | `600000` | Max wait time in ms |

## Debug Logging

Uses the [`debug`](https://www.npmjs.com/package/debug) package. Enable with the `DEBUG` environment variable:

```bash
DEBUG=authloop:sdk*        # all SDK logs
DEBUG=authloop:sdk:http    # HTTP request/response only
DEBUG=authloop:*           # all AuthLoop packages (SDK + MCP)
```

## Get an API Key

Sign up at [authloop.ai](https://authloop.ai) — 25 free auth assists, no credit card required.

## License

MIT
