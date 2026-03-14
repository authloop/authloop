#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Authloop } from "@authloop-ai/sdk";
import { z } from "zod";
import { runHandoff } from "./session.js";

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

server.registerTool(
  "authloop_handoff",
  {
    description:
      "Hand off an authentication challenge (OTP, captcha, password) to a human. " +
      "Creates a live session where the human can see the browser and type credentials. " +
      "Returns when the human completes the auth or the session times out.",
    inputSchema: {
      service: z.string().describe("Name of the service requiring auth (e.g. 'HDFC NetBanking')"),
      cdp_url: z.string().describe("Chrome DevTools Protocol WebSocket URL (e.g. ws://localhost:9222)"),
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
    try {
      const result = await runHandoff(client, {
        service: args.service,
        cdpUrl: args.cdp_url,
        context: args.context
          ? {
              url: args.context.url,
              blockerType: args.context.blocker_type,
              hint: args.context.hint,
            }
          : undefined,
      });

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
      return {
        content: [{ type: "text" as const, text: `Handoff failed: ${message}` }],
        isError: true,
      };
    }
  },
);

// Graceful shutdown
function shutdown() {
  server.close().then(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Start
const transport = new StdioServerTransport();
await server.connect(transport);
