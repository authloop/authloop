/**
 * Session lifecycle: create -> poll -> stream -> resolve
 */

import { Authloop } from "@authloop-ai/sdk";
import { BrowserStream, type StreamResult } from "./stream.js";

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

  let stream: BrowserStream | null = null;

  try {
    // 1. Create session via SDK
    const session = await client.handoff({
      service: options.service,
      cdpUrl: options.cdpUrl,
      context: options.context,
    });

    // 2. Poll until ACTIVE or terminal
    let status = await client.getSession(session.sessionId);
    while (status.status === "PENDING") {
      await new Promise((r) => setTimeout(r, 3000));
      status = await client.getSession(session.sessionId);
    }

    if (status.status !== "ACTIVE") {
      return { sessionUrl: session.sessionUrl, status: status.status === "RESOLVED" ? "resolved" : "error" };
    }

    // 3. Start browser stream
    stream = new BrowserStream({
      livekitUrl: session.livekitUrl,
      streamToken: session.streamToken,
      cdpUrl: options.cdpUrl,
    });
    await stream.start();

    // 4. Wait for resolution
    const result = await stream.waitForResolution();

    // 5. On resolved, tell the API
    if (result === "resolved") {
      await client.resolveSession(session.sessionId).catch(() => {});
    }

    return { sessionUrl: session.sessionUrl, status: result };
  } finally {
    await stream?.stop();
    activeSession = false;
  }
}
