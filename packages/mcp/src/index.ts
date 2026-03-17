#!/usr/bin/env node

import createDebug from "debug";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AuthLoop } from "@authloop-ai/sdk";
import { z } from "zod";
import { startSession, waitForStatus, stopSession } from "@authloop-ai/core";

const debug = createDebug("authloop:mcp");

// Validate required env
const apiKey = process.env.AUTHLOOP_API_KEY;
if (!apiKey) {
  console.error("AUTHLOOP_API_KEY environment variable is required");
  process.exit(1);
}

const authloop = new AuthLoop({
  apiKey,
  baseUrl: process.env.AUTHLOOP_BASE_URL,
});

const server = new McpServer({
  name: "@authloop-ai/mcp",
  version: "0.1.0",
});

// --- Tool 1: authloop_to_human ---

debug("registering authloop_to_human tool");

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

    debug("authloop_to_human called: service=%s cdp_url=%s", args.service, cdpUrl);

    try {
      const result = await startSession(authloop, {
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

      debug("authloop_to_human result: sessionId=%s", result.sessionId);

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
            text: "Session created. Send the session_url to the human via your communication channel " +
              "(Telegram, Slack, email, or show it in chat). " +
              "Then call authloop_status to wait for the human to resolve the auth challenge.",
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      debug("authloop_to_human error: %s", message);
      return {
        content: [
          {
            type: "text" as const,
            text: `AuthLoop failed: ${message}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// --- Tool 2: authloop_status ---

debug("registering authloop_status tool");

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
    debug("authloop_status called");

    try {
      const result = await waitForStatus();

      if (!result) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No active AuthLoop session. Call authloop_to_human first.",
            },
          ],
        };
      }

      debug("authloop_status: status=%s", result.status);

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

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { session_id: result.sessionId, session_url: result.sessionUrl, status: result.status },
              null,
              2,
            ),
          },
          {
            type: "text" as const,
            text: guidance[result.status] ?? "Unexpected status. Check the browser page.",
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      debug("authloop_status error: %s", message);
      return {
        content: [
          {
            type: "text" as const,
            text: `AuthLoop status check failed: ${message}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// Graceful shutdown
async function shutdown() {
  debug("shutting down");
  await stopSession();
  await server.close();
  process.exit(0);
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
