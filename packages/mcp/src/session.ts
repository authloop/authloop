/**
 * Session lifecycle: create → connect WebSocket → wait for viewer → stream → resolve
 */

import createDebug from "debug";
import { Authloop } from "@authloop-ai/sdk";
import { BrowserStream, type StreamResult } from "./stream.js";

const debug = createDebug("authloop:session");
const perf = createDebug("authloop:perf");

export interface HandoffInput {
  service: string;
  cdpUrl: string;
  context?: {
    url?: string;
    blockerType?: "otp" | "password" | "captcha" | "security_question" | "document_upload" | "other";
    hint?: string;
  };
}

export interface HandoffOutput {
  sessionUrl: string;
  status: StreamResult;
}

let activeSession = false;

/** @internal — exposed for testing only */
export function _resetActiveSession() {
  activeSession = false;
}

export async function runHandoff(
  client: Authloop,
  options: HandoffInput,
): Promise<HandoffOutput> {
  if (activeSession) {
    throw new Error("A handoff session is already in progress");
  }
  activeSession = true;
  debug("starting handoff: service=%s", options.service);

  let stream: BrowserStream | null = null;
  let ws: WebSocket | null = null;
  const handoffStart = Date.now();

  try {
    // 1. Create session via SDK
    const session = await client.handoff({
      service: options.service,
      cdpUrl: options.cdpUrl,
      context: options.context,
    });
    debug("session created: id=%s url=%s", session.sessionId, session.sessionUrl);
    perf("[perf:session] session created → WebSocket connect: %dms", Date.now() - handoffStart);

    // 2. Connect WebSocket immediately (no polling)
    const wsUrl = `${session.streamUrl}?token=${encodeURIComponent(session.streamToken)}&role=agent`;
    debug("connecting to relay WebSocket");
    const wsConnectStart = Date.now();

    ws = await new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(wsUrl);
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error("WebSocket connection timed out after 15s"));
      }, 15000);

      socket.addEventListener("open", () => {
        clearTimeout(timeout);
        resolve(socket);
      });
      socket.addEventListener("error", (e) => {
        clearTimeout(timeout);
        reject(new Error(`WebSocket error: ${(e as ErrorEvent).message ?? "connection failed"}`));
      });
    });

    perf("[perf:stream] WebSocket connect: %dms", Date.now() - wsConnectStart);
    debug("relay connected, waiting for viewer...");

    // 3. Wait for viewer_connected or terminal event (no polling!)
    const waitStart = Date.now();
    const waitResult = await new Promise<StreamResult>((resolve) => {
      ws!.addEventListener("message", (event) => {
        if (typeof event.data !== "string") return;
        try {
          const msg = JSON.parse(event.data) as Record<string, unknown>;
          if (msg.type === "viewer_connected") {
            debug("viewer connected");
            resolve("resolved"); // use "resolved" as signal to proceed
          } else if (msg.type === "session_expired") {
            debug("session expired while waiting for viewer");
            resolve("timeout");
          } else if (msg.type === "session_cancelled") {
            debug("session cancelled while waiting for viewer");
            resolve("cancelled");
          }
        } catch {
          // ignore parse errors
        }
      });
      ws!.addEventListener("close", () => {
        debug("relay WebSocket closed while waiting for viewer");
        resolve("error");
      });
    });

    perf("[perf:session] total wait duration (PENDING → %s): %dms (via WebSocket push, no polling)", waitResult === "resolved" ? "ACTIVE" : waitResult, Date.now() - waitStart);
    perf("[perf:session] poll count: 0 (WebSocket push)");

    if (waitResult !== "resolved") {
      debug("session terminated before viewer joined: %s", waitResult);
      ws.close();
      return { sessionUrl: session.sessionUrl, status: waitResult };
    }

    // 4. Start browser stream — reuse the already-connected WebSocket
    debug("starting browser stream");
    stream = new BrowserStream({
      ws,
      cdpUrl: options.cdpUrl,
    });
    await stream.start();
    debug("browser stream started");

    // 5. Wait for resolution
    const result = await stream.waitForResolution();
    debug("stream result: %s", result);

    // 6. Tell the API the outcome
    if (result === "resolved") {
      debug("resolving session %s", session.sessionId);
      await client.resolveSession(session.sessionId).catch(() => {});
    } else if (result === "cancelled") {
      debug("cancelling session %s (viewer cancelled)", session.sessionId);
      await client.cancelSession(session.sessionId).catch(() => {});
    }

    return { sessionUrl: session.sessionUrl, status: result };
  } finally {
    await stream?.stop();
    // If stream never started, close the WebSocket
    if (!stream && ws) {
      ws.close();
    }
    activeSession = false;
    debug("handoff complete");
  }
}
