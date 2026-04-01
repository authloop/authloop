#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AuthLoop, AuthLoopError } from "@authloop-ai/sdk";
import { z } from "zod";

const apiKey = process.env.AUTHLOOP_API_KEY;
if (!apiKey) {
  console.error("AUTHLOOP_API_KEY environment variable is required");
  process.exit(1);
}

const sdk = new AuthLoop({ apiKey, baseUrl: process.env.AUTHLOOP_BASE_URL });
const server = new McpServer({ name: "@authloop-ai/mcp", version: "0.2.2" });

let activeSessionId: string | undefined;

server.registerTool(
  "authloop_to_human",
  {
    description:
      "Loop an auth challenge (OTP, captcha, password) to a human who can resolve it remotely. " +
      "Returns a session_url — send this to the human via your communication channel. " +
      "After sending the URL, call authloop_status to wait for the human to resolve it.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      service: z.string().describe("Name of the service requiring auth (e.g. 'HDFC NetBanking')"),
      cdp_url: z.string().optional().describe(
        "CDP endpoint of the browser to screencast. " +
        "Accepts HTTP (http://127.0.0.1:9222) or WebSocket URLs. " +
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
        content: [{
          type: "text" as const,
          text: "No CDP URL provided. Pass cdp_url in the tool call or set AUTHLOOP_CDP_URL environment variable.",
        }],
        isError: true,
      };
    }

    try {
      const result = await sdk.toHuman({
        service: args.service,
        cdpUrl,
        context: args.context
          ? { url: args.context.url, blockerType: args.context.blocker_type, hint: args.context.hint }
          : undefined,
      });

      activeSessionId = result.sessionId;

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
            text: "Session created. Send the session_url to the human. Then call authloop_status to wait for resolution.",
          },
        ],
      };
    } catch (error) {
      if (error instanceof AuthLoopError && error.code === "extension_not_connected") {
        return {
          content: [
            {
              type: "text" as const,
              text: "The AuthLoop browser extension is not connected. " +
                "Ask the human to install the AuthLoop extension from authloop.ai/extension and pair it with their API key. " +
                "Once paired, retry by calling authloop_to_human again.",
            },
          ],
          isError: true,
        };
      }
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text" as const, text: `AuthLoop failed: ${message}` }], isError: true };
    }
  },
);

const guidance: Record<string, string> = {
  RESOLVED:
    "The human resolved the auth challenge. " +
    "Verify the browser page has moved past the auth wall before continuing your task.",
  CANCELLED:
    "The human cancelled the session without resolving the auth challenge. " +
    "Check the browser page — if the auth wall is still present, ask the user whether to retry.",
  TIMEOUT:
    "The session expired before the human could resolve it. " +
    "You may retry by calling authloop_to_human again.",
  ERROR:
    "The session ended unexpectedly (connection dropped or internal error). " +
    "Check the browser page — the auth may have been resolved despite the error. " +
    "If the auth wall is still present, you may retry by calling authloop_to_human again.",
};

server.registerTool(
  "authloop_status",
  {
    description:
      "Wait for an active AuthLoop session to complete. " +
      "Call this after authloop_to_human and after sending the session_url to the human. " +
      "This tool blocks until the human resolves, cancels, or the session times out. " +
      "If status is 'resolved', the auth challenge is complete — verify the browser moved past the auth wall.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {},
  },
  async () => {
    if (!activeSessionId) {
      return { content: [{ type: "text" as const, text: "No active AuthLoop session. Call authloop_to_human first." }] };
    }

    try {
      const result = await sdk.waitForResolution(activeSessionId);
      activeSessionId = undefined;

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
      activeSessionId = undefined;
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text" as const, text: `AuthLoop status check failed: ${message}` }], isError: true };
    }
  },
);

async function shutdown() {
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
