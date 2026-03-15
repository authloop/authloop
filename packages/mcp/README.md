# @authloop-ai/mcp

MCP server for [AuthLoop](https://authloop.ai) — human-in-the-loop authentication for AI agents.

Exposes the `authloop_handoff` tool so AI agents can hand off auth challenges (OTP, captcha, password) to a human via the [Model Context Protocol](https://modelcontextprotocol.io).

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

**OpenClaw** (`openclaw.json`):
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

## Tool: `authloop_handoff`

Hand off a login or auth challenge to a human who can resolve it remotely.

### Input

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `service` | `string` | Yes | Name of the service (e.g. `'HDFC NetBanking'`) |
| `cdp_url` | `string` | Yes | CDP endpoint — HTTP (`http://127.0.0.1:18800`) or WebSocket URL. HTTP endpoints are auto-resolved via `/json/version`. |
| `context.url` | `string` | No | Current page URL |
| `context.blocker_type` | `string` | No | `'otp'`, `'password'`, `'captcha'`, `'security_question'`, `'document_upload'`, `'other'` |
| `context.hint` | `string` | No | Hint for the human |

### Output

```json
{
  "session_url": "https://authloop.ai/session/sess_...",
  "status": "resolved"
}
```

Status is one of: `resolved`, `error`, `timeout`.

## How It Works

```
Agent                    MCP Server                  Relay                    Human
  │                          │                         │                       │
  │ calls authloop_handoff   │                         │                       │
  │─────────────────────────→│                         │                       │
  │                          │ POST /session            │                       │
  │                          │────────────────────────→ │                       │
  │                          │ polls until ACTIVE       │                       │
  │                          │────────────────────────→ │                       │
  │                          │                          │                       │
  │                          │ CDP screencast ──→ JPEG frames over WSS ──→    │
  │                          │                          │                       │
  │                          │           E2EE keystrokes over WSS ←───────    │
  │                          │ CDP dispatch ←────       │                       │
  │                          │                          │                       │
  │                          │        { "type": "resolved" } ←────────────    │
  │                          │ POST /session/:id/resolve│                       │
  │  { status: "resolved" }  │                         │                       │
  │←─────────────────────────│                         │                       │
```

1. Agent calls `authloop_handoff` when it hits an auth wall
2. MCP server creates a session via the AuthLoop API
3. Agent sends the `session_url` to the human (Telegram, Slack, etc.)
4. MCP server captures the browser tab via CDP screencast
5. JPEG frames stream to the human's browser over WebSocket
6. Human sees the live browser, clicks and types
7. Keystrokes are end-to-end encrypted (E2EE) and dispatched to the browser via CDP
8. Human clicks "Resolve" — session completes, agent continues

## Security

### End-to-End Encryption (E2EE)

All keystrokes and paste events are end-to-end encrypted between the human's browser and the MCP server. The relay server **cannot read passwords or OTPs**.

- **Key exchange**: ECDH on P-256 curve
- **Encryption**: AES-256-GCM (12-byte IV, 16-byte auth tag)
- **What's encrypted**: keypress, keydown, keyup, paste (sensitive input)
- **What's NOT encrypted**: click coordinates, scroll events, frames (visible page content)

The key exchange happens automatically when the viewer connects — no configuration needed.

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

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AUTHLOOP_API_KEY` | Yes | API key from [authloop.ai/dashboard](https://authloop.ai/dashboard/api-keys) |
| `AUTHLOOP_BASE_URL` | No | Override API URL (default: `https://api.authloop.ai`) |
| `DEBUG` | No | Enable debug logs (e.g. `authloop:*`) |

### Debug namespaces

```bash
DEBUG=authloop:*           # everything
DEBUG=authloop:mcp         # MCP server + tool calls
DEBUG=authloop:session     # session lifecycle (create, poll, resolve)
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

Sign up at [authloop.ai](https://authloop.ai) — 25 free handoffs, no credit card required.

## License

MIT
