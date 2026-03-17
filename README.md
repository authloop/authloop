# AuthLoop

**When AI can't get in, you step in.**

AuthLoop is a human-in-the-loop authentication layer for AI agents. When your agent hits an OTP, captcha, or password wall — the human gets a tap-to-resolve notification, sees the live browser tab, types the code, and the agent continues.

## Packages

| Package | Description |
|---------|-------------|
| [`@authloop-ai/sdk`](./packages/sdk) | TypeScript SDK for any agent runtime |
| [`@authloop-ai/core`](./packages/core) | Core engine — CDP screencast, E2EE, WebSocket relay |
| [`@authloop-ai/mcp`](./packages/mcp) | MCP server for Claude Desktop, Claude Code, and compatible agents |
| [`@authloop-ai/openclaw-authloop`](./packages/openclaw-plugin) | OpenClaw native plugin |

## Quick Start

### OpenClaw (Native Plugin)

```bash
openclaw plugins install @authloop-ai/openclaw-authloop
```

Then configure the plugin in OpenClaw settings:

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

### Claude Desktop / Claude Code (MCP)

Add to your MCP client config:

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

### Playwright / Any Agent (SDK)

```ts
import { AuthLoop } from '@authloop-ai/sdk';

const authloop = new AuthLoop({ apiKey: 'al_live_...' });

// When your agent hits an auth wall:
const session = await authloop.toHuman({
  service: 'HDFC NetBanking',
  cdpUrl: page.context().browser()!.wsEndpoint(),
  context: { blockerType: 'otp', hint: 'OTP sent to ****1234' }
});

// Send session.sessionUrl to the human (Telegram, Slack, etc.)
// Wait for the human to resolve it:
const result = await authloop.waitForResolution(session.sessionId);
// result.status === 'RESOLVED' → agent continues
```

## How It Works

```
Agent hits auth wall
  │
  ▼
authloop_to_human → creates session → returns session_url
  │
  ▼
Agent sends session_url to human (Telegram, Slack, chat)
  │
  ▼
authloop_status → blocks, streams browser via CDP in background
  │
  ▼
Human opens URL, sees live browser, types OTP/password (E2EE)
  │
  ▼
Keystrokes dispatched to browser via CDP → auth completes
  │
  ▼
authloop_status returns "resolved" → agent continues
```

The entire flow takes under 60 seconds.

## What It Handles

- SMS/Email OTP
- TOTP / Authenticator apps
- Password prompts
- reCAPTCHA / Turnstile
- Image captchas
- Security questions
- ID document uploads

## Security

### End-to-End Encryption

All keystrokes (passwords, OTPs) are end-to-end encrypted between the human's browser and the agent's machine. The relay server **cannot read what the human types**.

- **Key exchange**: ECDH (P-256) — both sides generate keypairs, exchange public keys, derive a shared secret. The relay only sees public keys and cannot compute the secret.
- **Encryption**: AES-256-GCM — each keystroke is individually encrypted with a random IV and authenticated with a GCM tag.
- **What's encrypted**: all user input — keystrokes, clicks, scroll, paste, navigation, resolve/cancel
- **What's NOT encrypted**: screenshots (visible page content only)

### Transport & Session Security

- All connections use WSS (TLS encrypted in transit)
- Session tokens are short-lived (10 minute default TTL)
- Each session is isolated — tokens grant access to one session only
- No credentials are stored or logged anywhere in the pipeline
- Debug logs never contain tokens, keys, or decrypted content

## Get an API Key

Sign up at [authloop.ai](https://authloop.ai) → Dashboard → API Keys.

**25 free auth assists** to get started. No credit card required.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and guidelines.

## License

[MIT](./LICENSE)
