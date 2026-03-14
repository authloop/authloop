# AuthLoop

**When AI can't get in, you step in.**

AuthLoop is a human-in-the-loop authentication layer for AI agents. When your agent hits an OTP, captcha, or password wall — the human gets a tap-to-resolve notification, sees the live browser tab, types the code, and the agent continues. Credentials never touch AuthLoop's servers.

## Packages

| Package | Description |
|---------|-------------|
| [`@authloop/sdk`](./packages/sdk) | TypeScript SDK for any agent runtime |
| [`@authloop/mcp`](./packages/mcp) | MCP server for OpenClaw and compatible agents |

## Quick Start

### OpenClaw (MCP)

Add to your `openclaw.json`:

```json
{
  "mcp": {
    "servers": {
      "authloop": {
        "command": "npx",
        "args": ["-y", "@authloop/mcp"],
        "env": { "AUTHLOOP_API_KEY": "al_live_..." }
      }
    }
  }
}
```

### Playwright / Any Agent (SDK)

```ts
import { Authloop } from '@authloop/sdk';

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

## What It Handles

- SMS/Email OTP
- TOTP / Authenticator apps
- Password prompts
- reCAPTCHA / Turnstile
- Image captchas
- Security questions
- ID document uploads

## How It Works

1. Agent hits an auth wall
2. Calls `authloop.handoff()` → gets a session URL
3. Sends the URL to the human (via Telegram, Slack, WhatsApp)
4. Human opens the URL on their phone → sees the live browser tab
5. Human types the OTP / solves the captcha
6. Agent continues automatically

The entire flow takes under 60 seconds. Credentials never leave the human's device.

## Get an API Key

Sign up at [authloop.ai](https://authloop.ai) → Dashboard → API Keys.

**25 free handoffs** to get started. No credit card required.

## License

MIT
