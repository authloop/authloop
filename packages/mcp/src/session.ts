/**
 * Session lifecycle: create -> poll -> stream -> resolve
 */

import createDebug from "debug";
import { Authloop } from "@authloop-ai/sdk";
import { BrowserStream, type StreamResult } from "./stream.js";

const debug = createDebug("authloop:session");

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

  try {
    // 1. Create session via SDK
    const session = await client.handoff({
      service: options.service,
      cdpUrl: options.cdpUrl,
      context: options.context,
    });
    debug("session created: id=%s url=%s", session.sessionId, session.sessionUrl);

    // 2. Poll until ACTIVE or terminal
    let status = await client.getSession(session.sessionId);
    debug("poll: status=%s", status.status);
    while (status.status === "PENDING") {
      await new Promise((r) => setTimeout(r, 3000));
      status = await client.getSession(session.sessionId);
      debug("poll: status=%s", status.status);
    }

    if (status.status !== "ACTIVE") {
      const statusMap: Record<string, StreamResult> = {
        RESOLVED: "resolved",
        TIMEOUT: "timeout",
        CANCELLED: "cancelled",
      };
      const mapped: StreamResult = statusMap[status.status] ?? "error";
      debug("session terminated during polling: %s → %s", status.status, mapped);
      return { sessionUrl: session.sessionUrl, status: mapped };
    }

    // 3. Start browser stream
    debug("starting browser stream");
    stream = new BrowserStream({
      streamUrl: session.streamUrl,
      streamToken: session.streamToken,
      cdpUrl: options.cdpUrl,
    });
    await stream.start();
    debug("browser stream started");

    // 4. Wait for resolution
    const result = await stream.waitForResolution();
    debug("stream result: %s", result);

    // 5. Tell the API the outcome
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
    activeSession = false;
    debug("handoff complete");
  }
}
