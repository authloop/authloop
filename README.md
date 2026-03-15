# AuthLoop

**When AI can't get in, you step in.**

AuthLoop is a human-in-the-loop authentication layer for AI agents. When your agent hits an OTP, captcha, or password wall — the human gets a tap-to-resolve notification, sees the live browser tab, types the code, and the agent continues.

## Packages

| Package | Description |
|---------|-------------|
| [`@authloop-ai/sdk`](./packages/sdk) | TypeScript SDK for any agent runtime |
| [`@authloop-ai/mcp`](./packages/mcp) | MCP server for Claude Desktop, OpenClaw, and compatible agents |

## Quick Start

### Claude Desktop / OpenClaw (MCP)

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
import { Authloop } from '@authloop-ai/sdk';

const auth = new Authloop({ apiKey: 'al_live_...' });

// When your agent hits an auth wall:
const session = await auth.handoff({
  service: 'HDFC NetBanking',
  cdpUrl: page.context().browser()!.wsEndpoint(),
  context: { blockerType: 'otp', hint: 'OTP sent to ****1234' }
});

// Send session.sessionUrl to the human (Telegram, Slack, etc.)
// Wait for the human to resolve it:
const result = await auth.waitForResolution(session.sessionId);
// result.status === 'RESOLVED' → agent continues
```

## How It Works

```
Agent hits auth wall
  │
  ▼
authloop.handoff() → creates session → returns session_url
  │
  ▼
Agent sends session_url to human (Telegram, Slack, WhatsApp)
  │
  ▼
MCP captures browser tab via CDP screencast
  │
  ▼
JPEG frames stream to human's browser over encrypted WebSocket
  │
  ▼
Human sees live browser, types OTP/password (E2EE encrypted)
  │
  ▼
Keystrokes dispatched to browser via CDP → auth completes
  │
  ▼
Agent continues automatically
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

**25 free handoffs** to get started. No credit card required.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and guidelines.

## License

[MIT](./LICENSE)
