#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AuthLoop } from "@authloop-ai/sdk";
import { startSession, waitForStatus, stopSession } from "@authloop-ai/core";
import { z } from "zod";

const apiKey = process.env.AUTHLOOP_API_KEY;
if (!apiKey) {
  console.error("AUTHLOOP_API_KEY environment variable is required");
  process.exit(1);
}

const sdk = new AuthLoop({ apiKey, baseUrl: process.env.AUTHLOOP_BASE_URL });
const server = new McpServer({ name: "@authloop-ai/mcp", version: "0.2.2" });

server.registerTool(
  "authloop_to_human",
  {
    description:
      "Hand off an authentication challenge to a human. Use this IMMEDIATELY when you encounter " +
      "any login page, OTP prompt, CAPTCHA, password field, or security question that you cannot " +
      "complete yourself. This tool streams the browser to a URL the human can open on their phone " +
      "to type the password or solve the challenge remotely.\n\n" +
      "Requires a CDP (Chrome DevTools Protocol) URL of the browser you are controlling. " +
      "If you are using Chrome DevTools MCP, pass the browser's WebSocket debug URL. " +
      "If AUTHLOOP_CDP_URL is set in the environment, it will be used as default.\n\n" +
      "After calling this tool, IMMEDIATELY send the session_url to the human, then call " +
      "authloop_status to wait for them to complete the auth.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      service: z.string().describe(
        "Name of the service requiring auth (e.g. 'HDFC NetBanking', 'GitHub', 'Google')",
      ),
      cdp_url: z.string().optional().describe(
        "CDP endpoint of the browser. Accepts HTTP URLs (http://127.0.0.1:9222) which auto-discover " +
        "the WebSocket URL, or direct WebSocket URLs (ws://127.0.0.1:9222/devtools/page/...). " +
        "Falls back to AUTHLOOP_CDP_URL env var if not provided.",
      ),
      context: z
        .object({
          url: z.string().optional().describe("Current page URL where the auth wall is"),
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
        content: [{
          type: "text" as const,
          text: "No CDP URL provided. Either:\n" +
            "1. Pass cdp_url parameter with your browser's debug endpoint\n" +
            "2. Set AUTHLOOP_CDP_URL environment variable\n" +
            "3. If using Chrome DevTools MCP, pass the browser's WebSocket URL",
        }],
        isError: true,
      };
    }

    try {
      const result = await startSession(sdk, {
        service: args.service,
        cdpUrl,
        context: args.context
          ? { url: args.context.url, blockerType: args.context.blocker_type, hint: args.context.hint }
          : undefined,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { session_id: result.sessionId, session_url: result.sessionUrl },
              null,
              2,
            ),
          },
          {
            type: "text" as const,
            text: "Session created and browser streaming started. " +
              "Send the session_url to the human NOW — they need to open it to see the browser and complete the auth. " +
              "Then call authloop_status to wait for them to finish.",
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text" as const, text: `AuthLoop failed: ${message}` }], isError: true };
    }
  },
);

const guidance: Record<string, string> = {
  resolved:
    "The human resolved the auth challenge. " +
    "Verify the browser page has moved past the auth wall before continuing your task.",
  cancelled:
    "The human cancelled the session without resolving the auth challenge. " +
    "Check the browser page — if the auth wall is still present, ask the user whether to retry.",
  timeout:
    "The session expired before the human could resolve it. " +
    "You may retry by calling authloop_to_human again.",
  error:
    "The session ended unexpectedly (connection dropped or internal error). " +
    "Check the browser page — the auth may have been resolved despite the error. " +
    "If the auth wall is still present, you may retry by calling authloop_to_human again.",
};

server.registerTool(
  "authloop_status",
  {
    description:
      "Wait for an active AuthLoop session to complete. " +
      "Call this AFTER authloop_to_human and AFTER sending the session_url to the human. " +
      "This tool blocks until the human resolves the auth, cancels, or the session times out.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {},
  },
  async () => {
    try {
      const result = await waitForStatus();

      if (!result) {
        return { content: [{ type: "text" as const, text: "No active AuthLoop session. Call authloop_to_human first." }] };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ session_id: result.sessionId, status: result.status }, null, 2),
          },
          { type: "text" as const, text: guidance[result.status] ?? "Unexpected status. Check the browser page." },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text" as const, text: `AuthLoop status check failed: ${message}` }], isError: true };
    }
  },
);

async function shutdown() {
  await stopSession();
  await server.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const transport = new StdioServerTransport();
server.connect(transport).catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
