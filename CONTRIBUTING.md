# Contributing to AuthLoop

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/authloop-ai/authloop.git
cd authloop
pnpm install
pnpm build
pnpm test
```

Requires Node.js >= 18 and pnpm 9+.

## Project Structure

```
packages/
  sdk/    → @authloop-ai/sdk — TypeScript HTTP client
  mcp/    → @authloop-ai/mcp — MCP server for AI agents
```

## Making Changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Add or update tests as needed
4. Run `pnpm build && pnpm test && pnpm check-types` to verify
5. If your change affects published packages, add a changeset: `pnpm changeset`
6. Open a pull request against `main`

## Changesets

This repo uses [changesets](https://github.com/changesets/changesets) for versioning. If your PR changes anything that affects published packages (`@authloop-ai/sdk` or `@authloop-ai/mcp`), run `pnpm changeset` before opening your PR. Pick the affected packages, choose a semver bump type, and write a short summary. This creates a file in `.changeset/` that gets included in your PR.

## Commit Messages

- Keep commits focused and descriptive
- Use imperative mood ("Add feature" not "Added feature")
- No AI attribution in commit messages

## Code Style

- TypeScript strict mode
- ESM modules (`"type": "module"`)
- camelCase for public API, snake_case for wire format (matching the REST API)

## Tests

### Unit tests

```bash
pnpm test                                    # all packages
pnpm --filter @authloop-ai/sdk test          # SDK only
pnpm --filter @authloop-ai/mcp test          # MCP only
```

### SDK integration tests (needs API key)

```bash
AUTHLOOP_API_KEY=al_live_... pnpm --filter @authloop-ai/sdk test:integration

# Against local API server:
AUTHLOOP_API_KEY=al_live_... AUTHLOOP_BASE_URL=http://localhost:8787 pnpm --filter @authloop-ai/sdk test:integration
```

### MCP E2E test (needs browser + local relay)

This tests the full flow: CDP screencast → WebSocket relay → viewer interaction → resolve.

**Terminal 1** — Launch a browser with CDP:
```bash
# Chrome
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 --user-data-dir=/tmp/authloop-test

# Brave
/Applications/Brave\ Browser.app/Contents/MacOS/Brave\ Browser \
  --remote-debugging-port=9222 --user-data-dir=/tmp/authloop-test
```
Skip any sign-in prompts. Navigate to a page with a login form (e.g. `https://github.com/login`).

**Terminal 2** — Start the local WebSocket relay:
```bash
node scripts/test-relay.mjs
```

**Terminal 3** — Run the E2E test:
```bash
DEBUG=authloop:* node scripts/test-e2e.mjs
```

**Browser** — Open the viewer:
```
http://localhost:8888
```

You should see the remote browser streaming live. Click on input fields, type, scroll. Click "Done" to resolve or "Cancel" to abort. All input is E2EE encrypted — check the log for `[encrypted]` tags.

### Full E2E test (needs API server + web app + browser)

This tests the complete flow through the real API, relay, and web app.

**Terminal 1** — Launch a browser with CDP:
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 --user-data-dir=/tmp/authloop-test
```
Navigate to a page with a login form.

**Terminal 2** — Run the full E2E test:
```bash
AUTHLOOP_API_KEY=al_live_... DEBUG=authloop:* node scripts/test-e2e-full.mjs

# Against local API server:
AUTHLOOP_API_KEY=al_live_... AUTHLOOP_BASE_URL=http://localhost:8787 \
  DEBUG=authloop:* node scripts/test-e2e-full.mjs
```

The script will:
1. Create a session via the API
2. Print a session URL — open it in your browser
3. Poll until you connect as the viewer
4. Start streaming the browser tab
5. Wait for you to click Done or Cancel
6. Call resolve/cancel on the API and exit

Tests use [vitest](https://vitest.dev/). Add tests for new functionality and ensure existing tests pass.

## Reporting Issues

Open an issue at [github.com/authloop-ai/authloop/issues](https://github.com/authloop-ai/authloop/issues).

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
