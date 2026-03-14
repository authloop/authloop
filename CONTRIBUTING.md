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

- SDK tests: `pnpm --filter @authloop-ai/sdk test`
- MCP tests: `pnpm --filter @authloop-ai/mcp test`
- All tests: `pnpm test`

Tests use [vitest](https://vitest.dev/). Add tests for new functionality and ensure existing tests pass.

## Reporting Issues

Open an issue at [github.com/authloop-ai/authloop/issues](https://github.com/authloop-ai/authloop/issues).

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
