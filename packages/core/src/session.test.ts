import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startSession, waitForStatus, stopSession, _resetActiveSession, _getActiveSession } from "./session.js";

// Mock the stream module — BrowserStream requires WebSocket + CDP connections
vi.mock("./stream.js", () => {
  const BrowserStream = vi.fn();
  BrowserStream.prototype.start = vi.fn().mockResolvedValue(undefined);
  BrowserStream.prototype.stop = vi.fn().mockResolvedValue(undefined);
  BrowserStream.prototype.waitForResolution = vi.fn().mockResolvedValue("resolved");
  return { BrowserStream };
});

// Mock WebSocket — session.ts connects to relay
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  private handlers = new Map<string, Function[]>();
  readyState = 1; // OPEN

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
    // Auto-connect on next tick
    setTimeout(() => this.emit("open", {}), 0);
  }

  addEventListener(event: string, handler: Function) {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  sent: string[] = [];
  send(data: string | ArrayBuffer) { if (typeof data === "string") this.sent.push(data); }
  close() {}

  // Test helpers
  emit(event: string, data: any) {
    for (const h of this.handlers.get(event) ?? []) h(data);
  }

  simulateMessage(data: unknown) {
    this.emit("message", { data: JSON.stringify(data) });
  }

  simulateClose() {
    this.emit("close", {});
  }
}

function createMockAuthloop() {
  return {
    toHuman: vi.fn().mockResolvedValue({
      sessionId: "sess_123",
      sessionUrl: "https://authloop.ai/session/sess_123",
      streamToken: "tok_abc",
      streamUrl: "wss://stream.example.com/stream/sess_123",
      expiresAt: "2026-03-14T12:00:00Z",
    }),
    getSession: vi.fn(),
    resolveSession: vi.fn().mockResolvedValue(undefined),
    cancelSession: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  _resetActiveSession();
  MockWebSocket.instances = [];
  vi.stubGlobal("WebSocket", MockWebSocket);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("startSession()", () => {
  it("creates session and returns sessionUrl + sessionId immediately", async () => {
    const authloop = createMockAuthloop();

    const result = await startSession(authloop as any, {
      service: "HDFC NetBanking",
      cdpUrl: "ws://localhost:9222",
      context: { blockerType: "otp", hint: "****1234" },
    });

    expect(authloop.toHuman).toHaveBeenCalledWith({
      service: "HDFC NetBanking",
      cdpUrl: "ws://localhost:9222",
      context: { blockerType: "otp", hint: "****1234" },
    });
    expect(result.sessionId).toBe("sess_123");
    expect(result.sessionUrl).toBe("https://authloop.ai/session/sess_123");
  });

  it("sets active session with streaming status", async () => {
    const authloop = createMockAuthloop();
    await startSession(authloop as any, { service: "Test", cdpUrl: "ws://x" });

    const active = _getActiveSession();
    expect(active).not.toBeNull();
    expect(active!.status).toBe("streaming");
  });

  it("connects WebSocket with correct URL and token", async () => {
    const authloop = createMockAuthloop();
    await startSession(authloop as any, { service: "Test", cdpUrl: "ws://x" });

    const ws = MockWebSocket.instances[0];
    expect(ws.url).toContain("wss://stream.example.com/stream/sess_123");
    expect(ws.url).toContain("token=tok_abc");
    expect(ws.url).toContain("role=agent");
  });

  it("rejects concurrent sessions", async () => {
    const authloop = createMockAuthloop();
    await startSession(authloop as any, { service: "Test1", cdpUrl: "ws://x" });

    await expect(
      startSession(authloop as any, { service: "Test2", cdpUrl: "ws://y" }),
    ).rejects.toThrow("already in progress");
  });

  it("propagates API errors", async () => {
    const authloop = createMockAuthloop();
    authloop.toHuman = vi.fn().mockRejectedValue(new Error("API error: 401"));

    await expect(
      startSession(authloop as any, { service: "Test", cdpUrl: "ws://x" }),
    ).rejects.toThrow("API error: 401");
  });
});

describe("waitForStatus()", () => {
  it("returns null when no session is active", async () => {
    const result = await waitForStatus();
    expect(result).toBeNull();
  });

  it("blocks until viewer connects and stream resolves", async () => {
    const authloop = createMockAuthloop();
    await startSession(authloop as any, { service: "Test", cdpUrl: "ws://x" });

    // Wait for WebSocket to connect
    await new Promise((r) => setTimeout(r, 10));
    const ws = MockWebSocket.instances[0];

    // Start waiting (non-blocking from test perspective)
    const promise = waitForStatus();

    // Simulate viewer joining — triggers streaming + resolution
    ws.simulateMessage({ type: "viewer_connected" });

    const result = await promise;
    expect(result).not.toBeNull();
    expect(result!.status).toBe("resolved");
    expect(result!.sessionId).toBe("sess_123");

    // Should be cleaned up
    expect(_getActiveSession()).toBeNull();
  });

  it("resolves with timeout on session_expired", async () => {
    const authloop = createMockAuthloop();
    await startSession(authloop as any, { service: "Test", cdpUrl: "ws://x" });
    await new Promise((r) => setTimeout(r, 10));

    const promise = waitForStatus();
    MockWebSocket.instances[0].simulateMessage({ type: "session_expired" });

    const result = await promise;
    expect(result!.status).toBe("timeout");
    expect(_getActiveSession()).toBeNull();
  });

  it("resolves with cancelled on session_cancelled", async () => {
    const authloop = createMockAuthloop();
    await startSession(authloop as any, { service: "Test", cdpUrl: "ws://x" });
    await new Promise((r) => setTimeout(r, 10));

    const promise = waitForStatus();
    MockWebSocket.instances[0].simulateMessage({ type: "session_cancelled" });

    const result = await promise;
    expect(result!.status).toBe("cancelled");
  });

  it("resolves with error on WebSocket close and cancels session via API", async () => {
    const authloop = createMockAuthloop();
    await startSession(authloop as any, { service: "Test", cdpUrl: "ws://x" });
    await new Promise((r) => setTimeout(r, 10));

    const promise = waitForStatus();
    MockWebSocket.instances[0].simulateClose();

    const result = await promise;
    expect(result!.status).toBe("error");

    // Disconnect before stream started → must call cancelSession
    // so the API doesn't leave the session ACTIVE forever
    await new Promise((r) => setTimeout(r, 10));
    expect(authloop.cancelSession).toHaveBeenCalledWith("sess_123");
  });

  it("calls resolveSession on successful resolution", async () => {
    const authloop = createMockAuthloop();
    await startSession(authloop as any, { service: "Test", cdpUrl: "ws://x" });
    await new Promise((r) => setTimeout(r, 10));

    const promise = waitForStatus();
    MockWebSocket.instances[0].simulateMessage({ type: "viewer_connected" });

    await promise;
    // Give the async resolveSession call time to complete
    await new Promise((r) => setTimeout(r, 10));
    expect(authloop.resolveSession).toHaveBeenCalledWith("sess_123");
  });
});

describe("stopSession()", () => {
  it("cancels and cleans up active session", async () => {
    const authloop = createMockAuthloop();
    await startSession(authloop as any, { service: "Test", cdpUrl: "ws://x" });

    await stopSession();

    expect(authloop.cancelSession).toHaveBeenCalledWith("sess_123");
    expect(_getActiveSession()).toBeNull();
  });

  it("unblocks waitForStatus when called during wait", async () => {
    const authloop = createMockAuthloop();
    await startSession(authloop as any, { service: "Test", cdpUrl: "ws://x" });
    await new Promise((r) => setTimeout(r, 10));

    const promise = waitForStatus();

    // Stop while waiting — should unblock with cancelled
    await stopSession();

    const result = await promise;
    // waitForStatus returns null because active was cleared by stopSession
    expect(result).toBeNull();
  });

  it("does nothing when no session is active", async () => {
    await expect(stopSession()).resolves.not.toThrow();
  });
});
