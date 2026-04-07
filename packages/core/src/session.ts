/**
 * Session lifecycle: startSession → (agent sends URL) → waitForStatus → resolved → cleanup
 *
 * startSession() creates the session, connects WebSocket, starts CDP screencast in the
 * background, and returns immediately with the session_url for the agent to send to the human.
 *
 * waitForStatus() blocks until the session reaches a terminal state (resolved/cancelled/timeout/error).
 *
 * stopSession() cleans up the stream, WebSocket, and CDP connection.
 */

import createDebug from "debug";
import { AuthLoop } from "@authloop-ai/sdk";
import { BrowserStream, type StreamResult, type ScreencastOptions } from "./stream.js";

const debug = createDebug("authloop:session");
const perf = createDebug("authloop:perf");

export interface ToHumanInput {
  service: string;
  cdpUrl: string;
  context?: {
    url?: string;
    blockerType?: "otp" | "password" | "captcha" | "security_question" | "document_upload" | "other";
    hint?: string;
  };
  /** Screencast quality + resolution caps. Default: medium quality, native viewport (capped at 2560x1440). */
  screencast?: ScreencastOptions;
}

export interface StartSessionOutput {
  sessionId: string;
  sessionUrl: string;
}

export type SessionStatus = "streaming" | StreamResult;

export interface SessionStatusOutput {
  sessionId: string;
  sessionUrl: string;
  status: SessionStatus;
}

interface ActiveSession {
  sessionId: string;
  sessionUrl: string;
  status: SessionStatus;
  authloop: AuthLoop;
  stream: BrowserStream | null;
  ws: WebSocket;
  cdpUrl: string;
  screencast?: ScreencastOptions;
  startTime: number;
  expiresAt: string;
  /** Resolves when status changes from "streaming" to a terminal state */
  onTerminal: Promise<StreamResult>;
  resolveTerminal: ((result: StreamResult) => void) | null;
}

let active: ActiveSession | null = null;

/** @internal — exposed for testing only */
export function _resetActiveSession() {
  active = null;
}

/** @internal — exposed for testing only */
export function _getActiveSession() {
  return active;
}

/**
 * Transition the active session to a terminal status.
 * Resolves the terminal promise so waitForStatus() unblocks.
 */
function setTerminalStatus(result: StreamResult): void {
  if (!active || active.status !== "streaming") return;
  debug("terminal status: %s", result);
  active.status = result;
  active.resolveTerminal?.(result);
  active.resolveTerminal = null;
}

/**
 * Start a session: create via API, connect WebSocket, start CDP screencast in background.
 * Returns immediately with session_url for the agent to send to the human.
 */
export async function startSession(
  authloop: AuthLoop,
  options: ToHumanInput,
): Promise<StartSessionOutput> {
  if (active) {
    throw new Error("A session is already in progress");
  }

  debug("startSession: service=%s", options.service);
  const startTime = Date.now();

  // 1. Create session via SDK
  const session = await authloop.toHuman({
    service: options.service,
    cdpUrl: options.cdpUrl,
    context: options.context,
  });
  debug("session created: id=%s url=%s", session.sessionId, session.sessionUrl);
  perf("[perf:session] session created: %dms", Date.now() - startTime);

  // 2. Connect WebSocket immediately
  const wsUrl = `${session.streamUrl}?token=${encodeURIComponent(session.streamToken)}&role=agent`;
  debug("connecting to relay WebSocket");
  const wsConnectStart = Date.now();

  const ws = await new Promise<WebSocket>((resolve, reject) => {
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
  debug("relay connected");

  // 3. Set up terminal promise
  let resolveTerminal: ((result: StreamResult) => void) | null = null;
  const onTerminal = new Promise<StreamResult>((resolve) => {
    resolveTerminal = resolve;
  });

  // 4. Set up active session
  active = {
    sessionId: session.sessionId,
    sessionUrl: session.sessionUrl,
    status: "streaming",
    authloop,
    stream: null,
    ws,
    cdpUrl: options.cdpUrl,
    screencast: options.screencast,
    startTime,
    expiresAt: session.expiresAt,
    onTerminal,
    resolveTerminal,
  };

  // 5. Listen for events in background
  ws.addEventListener("message", (event) => {
    if (!active || typeof event.data !== "string") return;
    try {
      const msg = JSON.parse(event.data) as Record<string, unknown>;
      if (msg.type === "viewer_connected" && !active.stream) {
        debug("viewer connected, starting browser stream");
        startStreaming().catch((err) => {
          debug("failed to start streaming: %s", (err as Error).message);
          setTerminalStatus("error");
        });
      } else if (msg.type === "session_expired") {
        debug("session expired");
        setTerminalStatus("timeout");
      } else if (msg.type === "session_cancelled") {
        debug("session cancelled");
        setTerminalStatus("cancelled");
      }
    } catch {
      // ignore parse errors
    }
  });

  ws.addEventListener("close", () => {
    if (active && active.status === "streaming") {
      debug("relay WebSocket closed unexpectedly");
      // If the stream never started (no viewer yet), the BrowserStream
      // resolution path won't run — call cancelSession directly.
      if (!active.stream) {
        active.authloop.cancelSession(active.sessionId).catch(() => {});
      }
      setTerminalStatus("error");
    }
  });

  perf("[perf:session] startSession total: %dms", Date.now() - startTime);

  return {
    sessionId: session.sessionId,
    sessionUrl: session.sessionUrl,
  };
}

/**
 * Start CDP screencast and wire up resolution events.
 * Called automatically when viewer connects.
 */
async function startStreaming(): Promise<void> {
  if (!active) return;

  const stream = new BrowserStream({
    ws: active.ws,
    cdpUrl: active.cdpUrl,
    screencast: active.screencast,
  });
  active.stream = stream;

  await stream.start();
  debug("browser stream started");

  // Wait for resolution in background
  stream.waitForResolution().then(async (result) => {
    if (!active) return;
    debug("stream result: %s", result);

    // Tell the API the outcome
    if (result === "resolved") {
      debug("resolving session %s", active.sessionId);
      await active.authloop.resolveSession(active.sessionId).catch(() => {});
    } else if (result === "cancelled" || result === "error") {
      // Cancel + error both mean "session is over without resolution".
      // Cancel API marks the session CANCELLED in KV+Neon and notifies viewers.
      // For "error" the cause was an unexpected disconnect — we still want
      // the API to know the session is dead so it doesn't sit ACTIVE forever.
      debug("cancelling session %s (reason=%s)", active.sessionId, result);
      await active.authloop.cancelSession(active.sessionId).catch(() => {});
    }

    setTerminalStatus(result);
  });
}

/**
 * Block until the session reaches a terminal state.
 * Returns null if no session is active.
 * Auto-cleans up after returning.
 */
export async function waitForStatus(): Promise<SessionStatusOutput | null> {
  if (!active) return null;

  debug("waitForStatus: waiting for terminal status...");

  // If already terminal, return immediately
  if (active.status !== "streaming") {
    const result: SessionStatusOutput = {
      sessionId: active.sessionId,
      sessionUrl: active.sessionUrl,
      status: active.status,
    };
    debug("waitForStatus: already terminal=%s", active.status);
    await cleanup();
    return result;
  }

  // Race terminal promise against session expiry
  const msUntilExpiry = new Date(active.expiresAt).getTime() - Date.now();
  const safeTimeout = Math.max(msUntilExpiry + 5000, 30000); // server TTL + 5s buffer, min 30s
  debug("waitForStatus: timeout in %ds", Math.round(safeTimeout / 1000));

  const terminalResult = await Promise.race([
    active.onTerminal,
    new Promise<StreamResult>((resolve) =>
      setTimeout(() => resolve("timeout"), safeTimeout),
    ),
  ]);

  // active may have been cleared by stopSession() during the wait
  if (!active) return null;

  // If we timed out client-side, trigger cleanup
  if (terminalResult === "timeout" && active.status === "streaming") {
    setTerminalStatus("timeout");
  }

  const result: SessionStatusOutput = {
    sessionId: active.sessionId,
    sessionUrl: active.sessionUrl,
    status: terminalResult,
  };

  debug("waitForStatus: resolved with status=%s", terminalResult);
  await cleanup();
  return result;
}

/**
 * Stop the active session and clean up all resources.
 */
export async function stopSession(): Promise<void> {
  if (!active) return;
  debug("stopSession: sessionId=%s", active.sessionId);

  // Cancel on the API if still streaming
  if (active.status === "streaming") {
    await active.authloop.cancelSession(active.sessionId).catch(() => {});
  }

  // Resolve the terminal promise so waitForStatus() unblocks
  setTerminalStatus("cancelled");

  await cleanup();
}

async function cleanup(): Promise<void> {
  if (!active) return;
  const session = active;
  active = null;

  await session.stream?.stop();
  if (!session.stream) {
    session.ws.close();
  }

  perf("[perf:session] session duration: %ds", Math.round((Date.now() - session.startTime) / 1000));
  debug("session cleaned up");
}
