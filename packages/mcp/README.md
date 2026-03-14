# @authloop-ai/mcp

MCP server for [AuthLoop](https://authloop.ai) — human-in-the-loop authentication for AI agents.

Exposes the `authloop_handoff` tool so AI agents can hand off auth challenges (OTP, captcha, password) to a human via the [Model Context Protocol](https://modelcontextprotocol.io).

## Setup

Add to your MCP client config (e.g. `claude_desktop_config.json`):

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

## Tool: `authloop_handoff`

Creates a live session where the human can see the browser and type credentials.

### Input

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `service` | `string` | Yes | Name of the service (e.g. `'HDFC NetBanking'`) |
| `cdp_url` | `string` | Yes | Chrome DevTools Protocol WebSocket URL |
| `context.url` | `string` | No | Current page URL |
| `context.blocker_type` | `string` | No | `'otp'`, `'password'`, `'captcha'`, `'security_question'`, `'document_upload'`, `'other'` |
| `context.hint` | `string` | No | Hint for the human |

### Output

```json
{
  "session_url": "https://app.authloop.ai/s/sess_...",
  "status": "resolved"
}
```

Status is one of: `resolved`, `error`, `timeout`.

## How It Works

1. Agent calls `authloop_handoff` when it hits an auth wall
2. MCP server creates a session via the AuthLoop API
3. Agent sends the `session_url` to the human (Telegram, Slack, etc.)
4. MCP server streams the browser tab to the human via LiveKit
5. Human sees the live browser, types the OTP/password
6. Keystrokes are dispatched to the browser via CDP
7. Session resolves, agent continues

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
DEBUG=authloop:stream      # LiveKit + video frames
DEBUG=authloop:cdp         # CDP WebSocket commands/events
DEBUG=authloop:sdk*        # SDK HTTP client
```

## Get an API Key

Sign up at [authloop.ai](https://authloop.ai) — 25 free handoffs, no credit card required.

## License

MIT
