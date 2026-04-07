import { AuthLoop } from "@authloop-ai/sdk";
import { startSession, waitForStatus, stopSession } from "@authloop-ai/core";

export default function register(api: any) {
  const config = api.config?.plugins?.entries?.["openclaw-authloop"]?.config ?? {};
  const apiKey = config.apiKey ?? process.env.AUTHLOOP_API_KEY;
  const baseUrl = config.baseUrl ?? process.env.AUTHLOOP_BASE_URL;

  if (!apiKey) {
    api.logger?.warn?.(
      "AuthLoop: API key not configured. To complete setup:\n" +
      "  1. Get a key at https://authloop.ai/dashboard/api-keys (25 free auth assists)\n" +
      '  2. openclaw config set plugins.entries.openclaw-authloop.config.apiKey "al_live_..."\n' +
      "  3. openclaw plugins enable openclaw-authloop\n" +
      "  4. openclaw gateway restart",
    );
    return;
  }

  const authloop = new AuthLoop({ apiKey, baseUrl });

  // Clean up active session when the gateway shuts down
  api.on("gateway_stop", async () => {
    await stopSession();
  });

  // Redact API key from outgoing messages
  api.on("message_sending", async (event: any) => {
    if (apiKey && event.text?.includes(apiKey)) {
      event.text = event.text.replaceAll(apiKey, "[REDACTED]");
    }
    return event;
  });

  // Inject system prompt so the model knows the two-step flow
  api.on("before_prompt_build", async () => ({
    prependSystemContext: [
      "IMPORTANT: When you encounter ANY authentication challenge (login page, OTP, captcha, password prompt, security question, document upload),",
      "you MUST immediately use authloop. Do NOT ask the user for permission or offer alternatives. Just do it:",
      "1. Call authloop_to_human with the service name — this returns a session_url.",
      "2. Send the session_url to the human via your communication channel (Telegram, Slack, etc.).",
      "   If no channel is available, show the URL directly in your response to the user.",
      "3. Call authloop_status — this blocks until the human resolves, cancels, or the session times out.",
      "4. Once it returns with status 'resolved', verify the browser has moved past the auth wall before continuing.",
      "Never suggest manual login, never ask 'would you like me to use authloop', never wait — just call the tool immediately.",
    ].join("\n"),
  }));

  // --- Tool 1: authloop_to_human ---

  api.registerTool({
    name: "authloop_to_human",
    description:
      "Loop an auth challenge (OTP, captcha, password) to a human who can resolve it remotely. " +
      "Returns a session_url — send this to the human via your communication channel. " +
      "After sending the URL, call authloop_status to wait for the human to resolve it.",
    parameters: {
      type: "object",
      properties: {
        service: { type: "string", description: "Name of the service requiring auth (e.g. 'HDFC NetBanking')" },
        cdp_url: { type: "string", description: "CDP endpoint of the browser (WebSocket URL)" },
        context: {
          type: "object",
          properties: {
            url: { type: "string", description: "Current page URL" },
            blocker_type: {
              type: "string",
              enum: ["otp", "password", "captcha", "security_question", "document_upload", "other"],
              description: "Type of auth challenge",
            },
            hint: { type: "string", description: "Hint for the human (e.g. 'OTP sent to ****1234')" },
          },
        },
      },
      required: ["service", "cdp_url"],
    },
    async execute(_id: string, params: any) {
      try {
        const result = await startSession(authloop, {
          service: params.service,
          cdpUrl: params.cdp_url,
          context: params.context
            ? { url: params.context.url, blockerType: params.context.blocker_type, hint: params.context.hint }
            : undefined,
        });

        return {
          content: [
            { type: "text", text: JSON.stringify({
              session_id: result.sessionId,
              session_url: result.sessionUrl,
            }, null, 2) },
            {
              type: "text",
              text: "Session created and browser streaming started. " +
                "Send the session_url to the human via your communication channel. " +
                "Then call authloop_status to wait for the human to resolve the auth challenge.",
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `AuthLoop failed: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  });

  // --- Tool 2: authloop_status ---

  api.registerTool({
    name: "authloop_status",
    description:
      "Wait for an active AuthLoop session to complete. " +
      "Call this after authloop_to_human and after sending the session_url to the human. " +
      "This tool blocks until the human resolves, cancels, or the session times out. " +
      "If status is 'resolved', the auth challenge is complete — verify the browser moved past the auth wall.",
    parameters: {
      type: "object",
      properties: {},
    },
    async execute() {
      try {
        const result = await waitForStatus();

        if (!result) {
          return {
            content: [{ type: "text", text: "No active AuthLoop session. Call authloop_to_human first." }],
          };
        }

        const guidance: Record<string, string> = {
          resolved:
            "The human resolved the auth challenge. " +
            "Verify the browser page has moved past the auth wall before continuing.",
          cancelled:
            "The human cancelled the session. " +
            "Check the browser — if the auth wall is still present, ask the user whether to retry.",
          timeout:
            "The session expired. You may retry by calling authloop_to_human again.",
          error:
            "The session ended unexpectedly. Check the browser — the auth may have been resolved despite the error.",
        };

        return {
          content: [
            { type: "text", text: JSON.stringify({ session_id: result.sessionId, status: result.status }, null, 2) },
            { type: "text", text: guidance[result.status] ?? "Unexpected status. Check the browser page." },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `AuthLoop status check failed: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  });
}
