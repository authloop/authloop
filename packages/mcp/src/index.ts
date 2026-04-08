#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AuthLoop } from "@authloop-ai/sdk";
import {
  startSession,
  waitForStatus,
  stopSession,
  _getActiveSession,
} from "@authloop-ai/core";
import { z } from "zod";

const apiKey = process.env.AUTHLOOP_API_KEY;
if (!apiKey) {
  console.error("AUTHLOOP_API_KEY environment variable is required");
  process.exit(1);
}

const sdk = new AuthLoop({ apiKey, baseUrl: process.env.AUTHLOOP_BASE_URL });
const server = new McpServer(
  { name: "@authloop-ai/mcp", version: "0.2.2" },
  {
    instructions:
      "AuthLoop hands off authentication challenges to a human who solves them remotely. " +
      "When you encounter ANY auth wall during browser automation — login forms, OTP prompts, " +
      "CAPTCHAs, password fields, security questions, document uploads — IMMEDIATELY call " +
      "authloop_to_human, show the returned session_url to the user in your reply, then call " +
      "authloop_status in the same turn to wait for completion. Never ask the user to type " +
      "credentials, OTPs, or secrets into chat. If a chrome-devtools or browser-automation MCP " +
      "is available, get the CDP endpoint from it and pass it as cdp_url.",
  },
);

// ─── authloop_to_human ──────────────────────────────────────────────────────

const toHumanInputSchema = {
  service: z.string().describe(
    "Human-readable name of the service requiring auth (e.g. 'HDFC NetBanking', 'GitHub', 'Google Workspace'). Shown to the user.",
  ),
  cdp_url: z.string().optional().describe(
    "CDP (Chrome DevTools Protocol) endpoint of the browser you are controlling. " +
    "Accepts http://127.0.0.1:9222 (auto-discovers WebSocket URL) or ws://... " +
    "Falls back to AUTHLOOP_CDP_URL env var if omitted. " +
    "Get this from your browser automation tool: Playwright `browser.wsEndpoint()`, " +
    "Puppeteer `browser.wsEndpoint()`, Chrome DevTools MCP, or chrome --remote-debugging-port=9222.",
  ),
  context: z
    .object({
      url: z.string().optional().describe("URL of the page where the auth wall is"),
      blocker_type: z
        .enum(["otp", "password", "captcha", "security_question", "document_upload", "other"])
        .optional()
        .describe("Type of auth challenge — helps the user know what to expect"),
      hint: z.string().optional().describe("Hint shown to the user (e.g. 'OTP sent to ****1234')"),
    })
    .optional()
    .describe("Optional context shown on the session page to help the human"),
};

const toHumanOutputSchema = {
  session_id: z.string().describe("Unique session identifier"),
  session_url: z.string().describe("URL the human opens to see the browser and complete the auth challenge"),
};

server.registerTool(
  "authloop_to_human",
  {
    title: "Hand off auth to a human",
    description:
      "Hand off an authentication challenge (login, OTP, CAPTCHA, password, security question) " +
      "to a human who solves it remotely on their phone or another browser.\n\n" +
      "USE WHEN: you encounter ANY auth wall during browser automation. Don't ask the user " +
      "to type credentials in chat — call this tool instead.\n\n" +
      "RETURNS: a session_url. SHOW THIS URL TO THE USER IMMEDIATELY (in your reply, in chat, " +
      "wherever you communicate with them).\n\n" +
      "YOU MUST call authloop_status immediately after this tool, in the same turn. " +
      "Skipping it will orphan the session and the user's work will be lost.\n\n" +
      "REQUIREMENT: a CDP-enabled browser. Pass cdp_url (get it from chrome-devtools MCP, " +
      "Playwright/Puppeteer wsEndpoint, or chrome --remote-debugging-port=9222), or set " +
      "AUTHLOOP_CDP_URL env var.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: toHumanInputSchema,
    outputSchema: toHumanOutputSchema,
  },
  async (args) => {
    // Check for an in-progress session — surface a useful error instead of generic failure.
    if (_getActiveSession()) {
      return {
        content: [{
          type: "text" as const,
          text: "An AuthLoop session is already in progress. Call authloop_status to wait " +
            "for it to finish, or restart the MCP server to abandon it.",
        }],
        isError: true,
      };
    }

    const cdpUrl = args.cdp_url ?? process.env.AUTHLOOP_CDP_URL;
    if (!cdpUrl) {
      return {
        content: [{
          type: "text" as const,
          text: "No CDP URL provided. Pass cdp_url with your browser's debug endpoint " +
            "(e.g. http://127.0.0.1:9222 or the WebSocket URL from Playwright/Puppeteer), " +
            "or set AUTHLOOP_CDP_URL in the MCP server environment.",
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

      const structured = {
        session_id: result.sessionId,
        session_url: result.sessionUrl,
      };

      return {
        content: [{
          type: "text" as const,
          text:
            `Session created. Show this URL to the user:\n\n${result.sessionUrl}\n\n` +
            `After showing the URL, call authloop_status to wait for the user to complete the auth.`,
        }],
        structuredContent: structured,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text" as const, text: `AuthLoop failed: ${message}` }],
        isError: true,
      };
    }
  },
);

// ─── authloop_status ────────────────────────────────────────────────────────

const guidance: Record<string, string> = {
  resolved:
    "The user successfully completed the auth challenge. " +
    "Verify the browser has moved past the auth wall before continuing your task.",
  cancelled:
    "The user cancelled the session without resolving. " +
    "Check the browser — if the auth wall is still present, ask the user how to proceed.",
  timeout:
    "The session expired before the user completed the auth. " +
    "You may retry by calling authloop_to_human again.",
  error:
    "The session ended unexpectedly (network drop or platform error). " +
    "Check the browser — the auth may have been completed despite the error. " +
    "If the auth wall is still present, retry with authloop_to_human.",
};

const statusOutputSchema = {
  session_id: z.string().describe("Session identifier"),
  status: z
    .enum(["resolved", "cancelled", "timeout", "error"])
    .describe("Terminal session state"),
};

server.registerTool(
  "authloop_status",
  {
    title: "Wait for AuthLoop session to finish",
    description:
      "Wait (block) for the active AuthLoop session to reach a terminal state. " +
      "Call this AFTER authloop_to_human and AFTER showing the session_url to the user.\n\n" +
      "BLOCKS for up to 10 minutes (default session TTL) until the user resolves, " +
      "cancels, or the session times out. Returns one of: resolved, cancelled, timeout, error.\n\n" +
      "Sends progress notifications while waiting (clients can show 'waiting for user…' UI). " +
      "Honors client cancellation — if the client aborts the request, the session is cancelled.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {},
    outputSchema: statusOutputSchema,
  },
  async (_args, extra) => {
    const progressToken = extra._meta?.progressToken;

    // Helper to send progress updates to the client (no-op if no progressToken).
    async function sendProgress(message: string) {
      if (progressToken === undefined) return;
      try {
        await extra.sendNotification({
          method: "notifications/progress",
          params: { progressToken, progress: 0, message },
        });
      } catch {
        // Notification failures are non-fatal — keep the wait going.
      }
    }

    // Periodic "still waiting" notifications so the client knows we're alive.
    await sendProgress("Waiting for the user to open the session URL and complete the auth…");
    const heartbeat = setInterval(() => {
      sendProgress("Still waiting for the user…").catch(() => {});
    }, 15_000);

    // Defensive timeout: server TTL is 10 minutes; give it 1 minute of slack.
    // If waitForStatus() ever wedges (e.g. silent WebSocket failure), guarantee
    // the tool returns instead of hanging forever.
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<null>((resolve) => {
      timeoutId = setTimeout(() => resolve(null), 11 * 60 * 1000);
    });

    // Honor client-side cancellation: if the abort signal fires while we wait,
    // stop the local session so the agent doesn't keep streaming forever.
    const onAbort = () => {
      stopSession().catch(() => {});
    };
    extra.signal.addEventListener("abort", onAbort);

    try {
      const result = await Promise.race([waitForStatus(), timeoutPromise]);

      if (!result) {
        return {
          content: [{
            type: "text" as const,
            text: "No active AuthLoop session. Call authloop_to_human first.",
          }],
          isError: true,
        };
      }

      const structured = {
        session_id: result.sessionId,
        status: result.status as "resolved" | "cancelled" | "timeout" | "error",
      };

      return {
        content: [{
          type: "text" as const,
          text: `Session ${result.status}. ${guidance[result.status] ?? "Unexpected status."}`,
        }],
        structuredContent: structured,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text" as const, text: `AuthLoop status check failed: ${message}` }],
        isError: true,
      };
    } finally {
      clearInterval(heartbeat);
      if (timeoutId) clearTimeout(timeoutId);
      extra.signal.removeEventListener("abort", onAbort);
    }
  },
);

// ─── shutdown ───────────────────────────────────────────────────────────────

async function shutdown() {
  await stopSession();
  await server.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ─── start ──────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
server.connect(transport).catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
