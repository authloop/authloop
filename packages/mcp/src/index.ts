#!/usr/bin/env node

import createDebug from "debug";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Authloop } from "@authloop-ai/sdk";
import { z } from "zod";
import { runHandoff } from "./session.js";

const debug = createDebug("authloop:mcp");

// Validate required env
const apiKey = process.env.AUTHLOOP_API_KEY;
if (!apiKey) {
  console.error("AUTHLOOP_API_KEY environment variable is required");
  process.exit(1);
}

const client = new Authloop({
  apiKey,
  baseUrl: process.env.AUTHLOOP_BASE_URL,
});

const server = new McpServer({
  name: "@authloop-ai/mcp",
  version: "0.1.0",
});

debug("registering authloop_handoff tool");

server.registerTool(
  "authloop_handoff",
  {
    description:
      "Hand off a login or auth challenge (OTP, captcha, password) to a human who can resolve it remotely. " +
      "The human sees the live browser, types the credentials, and the agent continues automatically.",
    inputSchema: {
      service: z.string().describe("Name of the service requiring auth (e.g. 'HDFC NetBanking')"),
      cdp_url: z
        .string()
        .optional()
        .describe(
          "CDP endpoint of the browser to screencast. " +
          "Accepts HTTP (http://127.0.0.1:18800) or WebSocket (ws://127.0.0.1:18800/devtools/page/...) URLs. " +
          "HTTP endpoints are auto-resolved via /json/version. " +
          "Falls back to AUTHLOOP_CDP_URL env var if not provided.",
        ),
      context: z
        .object({
          url: z.string().optional().describe("Current page URL"),
          blocker_type: z
            .enum(["otp", "password", "captcha", "security_question", "document_upload", "other"])
            .optional()
            .describe("Type of auth challenge"),
          hint: z.string().optional().describe("Hint for the human (e.g. 'OTP sent to ****1234')"),
        })
        .optional()
        .describe("Additional context about the auth challenge"),
    },
  },
  async (args) => {
    const cdpUrl = args.cdp_url ?? process.env.AUTHLOOP_CDP_URL;
    if (!cdpUrl) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No CDP URL provided. Either pass cdp_url in the tool call or set the AUTHLOOP_CDP_URL environment variable.",
          },
        ],
        isError: true,
      };
    }

    debug("authloop_handoff called: service=%s cdp_url=%s", args.service, cdpUrl);

    try {
      const result = await runHandoff(client, {
        service: args.service,
        cdpUrl,
        context: args.context
          ? {
              url: args.context.url,
              blockerType: args.context.blocker_type,
              hint: args.context.hint,
            }
          : undefined,
      });

      debug("authloop_handoff result: status=%s", result.status);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { session_url: result.sessionUrl, status: result.status },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      debug("authloop_handoff error: %s", message);
      return {
        content: [{ type: "text" as const, text: `Handoff failed: ${message}` }],
        isError: true,
      };
    }
  },
);

// Graceful shutdown
function shutdown() {
  debug("shutting down");
  server.close().then(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Start
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  debug("MCP server started on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
