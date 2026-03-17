# @authloop-ai/openclaw-authloop

OpenClaw native plugin for [AuthLoop](https://authloop.ai) — human-in-the-loop authentication for AI agents.

Registers the `authloop_to_human` and `authloop_status` tools so OpenClaw agents can hand off auth challenges (OTP, captcha, password) to a human who resolves them remotely.

## Install

```bash
openclaw plugins install @authloop-ai/openclaw-authloop
```

## Configure

In your OpenClaw settings, configure the AuthLoop plugin:

```json
{
  "plugins": {
    "entries": {
      "openclaw-authloop": {
        "enabled": true,
        "config": {
          "apiKey": "al_live_..."
        }
      }
    }
  }
}
```

To silence the `plugins.allow` advisory, explicitly allowlist the plugin:

```json
{
  "plugins": {
    "allow": ["openclaw-authloop"],
    "entries": {
      "openclaw-authloop": {
        "enabled": true,
        "config": {
          "apiKey": "al_live_..."
        }
      }
    }
  }
}
```

Or set the `AUTHLOOP_API_KEY` environment variable.

| Variable | Required | Description |
|----------|----------|-------------|
| `AUTHLOOP_API_KEY` | Yes | API key from [authloop.ai/dashboard](https://authloop.ai/dashboard/api-keys) |
| `AUTHLOOP_BASE_URL` | No | Override API URL (default: `https://api.authloop.ai`) |

## Tools

### `authloop_to_human`

Loop an auth challenge to a human. Returns a `session_url` immediately — the agent sends this to the human via its communication channel.

#### Input

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `service` | `string` | Yes | Name of the service (e.g. `'HDFC NetBanking'`) |
| `cdp_url` | `string` | Yes | CDP endpoint of the browser the agent is controlling |
| `context.url` | `string` | No | Current page URL |
| `context.blocker_type` | `string` | No | `'otp'`, `'password'`, `'captcha'`, `'security_question'`, `'document_upload'`, `'other'` |
| `context.hint` | `string` | No | Hint for the human |

#### Output

```json
{
  "session_id": "sess_...",
  "session_url": "https://authloop.ai/session/sess_..."
}
```

### `authloop_status`

Wait for the human to resolve the auth challenge. Blocks until resolved, cancelled, or timed out. No input required.

#### Output

```json
{
  "session_id": "sess_...",
  "session_url": "https://authloop.ai/session/sess_...",
  "status": "resolved"
}
```

Status is one of: `resolved`, `cancelled`, `error`, `timeout`.

## How It Works

1. Agent hits an auth wall (OTP, captcha, password)
2. Agent calls `authloop_to_human` → gets `session_url`
3. Agent sends the `session_url` to the human via Telegram, Slack, etc.
4. Plugin streams the browser tab via CDP screencast in the background
5. Agent calls `authloop_status` to wait for resolution
6. Human opens the URL, sees the live browser, types OTP/password (E2EE encrypted)
7. Keystrokes dispatched to browser via CDP — auth completes
8. `authloop_status` returns `resolved` → agent continues

## Security

All user input is end-to-end encrypted (ECDH P-256 + AES-256-GCM). The relay server cannot read what the human types.

## Get an API Key

Sign up at [authloop.ai](https://authloop.ai) — 25 free auth assists, no credit card required.

## License

MIT
