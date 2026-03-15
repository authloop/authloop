import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runHandoff, _resetActiveSession } from "./session.js";

// Mock the stream module — BrowserStream requires WebSocket + CDP connections
vi.mock("./stream.js", () => {
  const BrowserStream = vi.fn();
  BrowserStream.prototype.start = vi.fn().mockResolvedValue(undefined);
  BrowserStream.prototype.stop = vi.fn().mockResolvedValue(undefined);
  BrowserStream.prototype.waitForResolution = vi.fn().mockResolvedValue("resolved");
  return { BrowserStream };
});

// Mock WebSocket — session.ts connects to relay and waits for viewer_connected
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

  send() {}
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

function createMockClient() {
  return {
    handoff: vi.fn().mockResolvedValue({
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

describe("runHandoff()", () => {
  it("creates session and returns resolved on viewer_connected + stream resolved", async () => {
    const client = createMockClient();

    const promise = runHandoff(client as any, {
      service: "HDFC NetBanking",
      cdpUrl: "ws://localhost:9222",
      context: { blockerType: "otp", hint: "****1234" },
    });

    // Wait for WebSocket to connect
    await new Promise((r) => setTimeout(r, 10));
    const ws = MockWebSocket.instances[0];

    // Simulate viewer joining
    ws.simulateMessage({ type: "viewer_connected" });

    const result = await promise;

    expect(client.handoff).toHaveBeenCalledWith({
      service: "HDFC NetBanking",
      cdpUrl: "ws://localhost:9222",
      context: { blockerType: "otp", hint: "****1234" },
    });
    expect(result.sessionUrl).toBe("https://authloop.ai/session/sess_123");
    expect(result.status).toBe("resolved");
  });

  it("calls resolveSession on successful resolution", async () => {
    const client = createMockClient();

    const promise = runHandoff(client as any, { service: "Test", cdpUrl: "ws://x" });
    await new Promise((r) => setTimeout(r, 10));
    MockWebSocket.instances[0].simulateMessage({ type: "viewer_connected" });

    await promise;
    expect(client.resolveSession).toHaveBeenCalledWith("sess_123");
  });

  it("returns timeout when session expires while waiting for viewer", async () => {
    const client = createMockClient();

    const promise = runHandoff(client as any, { service: "Test", cdpUrl: "ws://x" });
    await new Promise((r) => setTimeout(r, 10));

    MockWebSocket.instances[0].simulateMessage({ type: "session_expired" });

    const result = await promise;
    expect(result.status).toBe("timeout");
  });

  it("returns cancelled when session is cancelled while waiting for viewer", async () => {
    const client = createMockClient();

    const promise = runHandoff(client as any, { service: "Test", cdpUrl: "ws://x" });
    await new Promise((r) => setTimeout(r, 10));

    MockWebSocket.instances[0].simulateMessage({ type: "session_cancelled" });

    const result = await promise;
    expect(result.status).toBe("cancelled");
  });

  it("returns error when WebSocket closes while waiting for viewer", async () => {
    const client = createMockClient();

    const promise = runHandoff(client as any, { service: "Test", cdpUrl: "ws://x" });
    await new Promise((r) => setTimeout(r, 10));

    MockWebSocket.instances[0].simulateClose();

    const result = await promise;
    expect(result.status).toBe("error");
  });

  it("connects WebSocket with correct URL and token", async () => {
    const client = createMockClient();

    const promise = runHandoff(client as any, { service: "Test", cdpUrl: "ws://x" });
    await new Promise((r) => setTimeout(r, 10));

    const ws = MockWebSocket.instances[0];
    expect(ws.url).toContain("wss://stream.example.com/stream/sess_123");
    expect(ws.url).toContain("token=tok_abc");
    expect(ws.url).toContain("role=agent");

    ws.simulateMessage({ type: "viewer_connected" });
    await promise;
  });

  it("rejects concurrent handoffs", async () => {
    const client = createMockClient();

    const p1 = runHandoff(client as any, { service: "Test1", cdpUrl: "ws://x" });

    await new Promise((r) => setTimeout(r, 10));

    await expect(
      runHandoff(client as any, { service: "Test2", cdpUrl: "ws://y" }),
    ).rejects.toThrow("already in progress");

    // Clean up p1
    MockWebSocket.instances[0].simulateMessage({ type: "session_expired" });
    await p1;
  });

  it("propagates handoff API errors", async () => {
    const client = createMockClient();
    client.handoff = vi.fn().mockRejectedValue(new Error("API error: 401"));

    await expect(
      runHandoff(client as any, { service: "Test", cdpUrl: "ws://x" }),
    ).rejects.toThrow("API error: 401");
  });
});
