# @authloop-ai/mcp

MCP server for [AuthLoop](https://authloop.ai) — human-in-the-loop authentication for AI agents.

Exposes `authloop_to_human` and `authloop_status` tools so AI agents can hand off auth challenges (OTP, captcha, password) to a human via the [Model Context Protocol](https://modelcontextprotocol.io).

## Setup

Add to your MCP client config:

**Claude Desktop** (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "authloop": {
      "command": "npx",
      "args": ["-y", "@authloop-ai/mcp"],
      "env": { "AUTHLOOP_API_KEY": "al_live_..." }
    }
  }
}
```

**Claude Code** (`claude_code_config.json`):
```json
{
  "mcpServers": {
    "authloop": {
      "command": "npx",
      "args": ["-y", "@authloop-ai/mcp"],
      "env": { "AUTHLOOP_API_KEY": "al_live_..." }
    }
  }
}
```

> **OpenClaw users**: Use the native plugin [`@authloop-ai/openclaw-authloop`](../openclaw-plugin) instead — install via `openclaw plugins install @authloop-ai/openclaw-authloop`.

## Tools

### `authloop_to_human`

Loop an auth challenge to a human. Returns a `session_url` immediately — the agent sends this to the human, then calls `authloop_status` to wait for resolution.

#### Input

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `service` | `string` | Yes | Name of the service (e.g. `'HDFC NetBanking'`) |
| `cdp_url` | `string` | No | CDP endpoint — HTTP or WebSocket URL. Falls back to `AUTHLOOP_CDP_URL` env var. |
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

1. Agent calls `authloop_to_human` when it hits an auth wall → gets `session_url`
2. Agent sends the `session_url` to the human (show in chat, Telegram, Slack, etc.)
3. MCP starts CDP screencast in the background, streams to relay
4. Agent calls `authloop_status` to wait for resolution
5. Human opens the URL, sees the live browser, types OTP/password (E2EE encrypted)
6. Keystrokes dispatched to browser via CDP — auth completes
7. `authloop_status` returns `resolved` → agent continues

## Security

### End-to-End Encryption (E2EE)

All user input is end-to-end encrypted between the human's browser and the MCP server. The relay server **cannot read what the human types or clicks**.

- **Key exchange**: ECDH on P-256 curve
- **Encryption**: AES-256-GCM (12-byte IV, 16-byte auth tag)
- **What's encrypted**: all user input — keystrokes, clicks, scroll, paste, navigation, resolve/cancel
- **What's NOT encrypted**: frames (visible page content — screenshots only)

The key exchange happens automatically when the viewer connects — no configuration needed. No input is accepted until E2EE is established.

### Transport Security

- All WebSocket connections use WSS (TLS encrypted)
- Session tokens are short-lived (10 minute TTL by default)
- Each session is isolated — tokens grant access to one session only
- No credentials are stored or logged by the MCP server

### Debug Log Safety

Debug logs (`DEBUG=authloop:*`) never contain:
- API keys or tokens
- Decrypted keystroke content
- Shared secrets or private keys
- Raw message payloads

## Supported Input

| Action | How |
|---|---|
| Click | Mouse click dispatched via CDP |
| Double-click | Double-click via CDP |
| Type characters | Keypress → CDP `char` event |
| Special keys | Backspace, Enter, Tab, arrows, Delete, F1-F12 with virtual key codes |
| Modifier combos | Ctrl/Cmd+A, Ctrl/Cmd+C, Shift+arrows, etc. |
| Paste | CDP `Input.insertText` — works on mobile too |
| Scroll | Mouse wheel via CDP |
| Back / Forward | Browser history navigation via CDP |
| Reload | Page reload via CDP |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AUTHLOOP_API_KEY` | Yes | API key from [authloop.ai/dashboard](https://authloop.ai/dashboard/api-keys) |
| `AUTHLOOP_CDP_URL` | No | Default CDP endpoint (used when `cdp_url` not passed in tool call) |
| `AUTHLOOP_BASE_URL` | No | Override API URL (default: `https://api.authloop.ai`) |
| `DEBUG` | No | Enable debug logs (e.g. `authloop:*`) |

### Debug namespaces

```bash
DEBUG=authloop:*           # everything
DEBUG=authloop:mcp         # MCP server + tool calls
DEBUG=authloop:session     # session lifecycle (create, connect, resolve)
DEBUG=authloop:stream      # WebSocket frames + input events
DEBUG=authloop:cdp         # CDP WebSocket commands/events
DEBUG=authloop:crypto      # E2EE key exchange
DEBUG=authloop:sdk*        # SDK HTTP client
```

## Browser Compatibility

Works with any Chromium-based browser exposing CDP:
- Chrome, Brave, Edge, Chromium
- OpenClaw managed browser profiles
- Remote CDP (Browserbase, Browserless)
- Local or remote — HTTP endpoints auto-resolved via `/json`

## Get an API Key

Sign up at [authloop.ai](https://authloop.ai) — 25 free auth assists, no credit card required.

## License

MIT
