#!/usr/bin/env node

// @authloop/mcp — MCP server for AI agent authentication handoff
// Provides the `authloop_handoff` tool to AI agents via MCP protocol
//
// Usage in openclaw.json:
// {
//   "mcp": {
//     "servers": {
//       "authloop": {
//         "command": "npx",
//         "args": ["-y", "@authloop/mcp"],
//         "env": { "AUTHLOOP_API_KEY": "al_live_..." }
//       }
//     }
//   }
// }

// TODO: Implement MCP server
// See TASKS.md for implementation details

console.error("@authloop/mcp is not yet implemented. See TASKS.md for details.");
process.exit(1);
