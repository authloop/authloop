import { describe, it, expect, vi, beforeEach } from "vitest";
import { runHandoff, _resetActiveSession } from "./session.js";

// Mock the stream module — BrowserStream is heavy (LiveKit + CDP)
vi.mock("./stream.js", () => {
  const BrowserStream = vi.fn();
  BrowserStream.prototype.start = vi.fn().mockResolvedValue(undefined);
  BrowserStream.prototype.stop = vi.fn().mockResolvedValue(undefined);
  BrowserStream.prototype.waitForResolution = vi.fn().mockResolvedValue("resolved");
  return { BrowserStream };
});

function createMockClient(opts?: {
  pollSequence?: string[];
}) {
  const pollSequence = opts?.pollSequence ?? ["ACTIVE"];
  let pollIndex = 0;

  return {
    handoff: vi.fn().mockResolvedValue({
      sessionId: "sess_123",
      sessionUrl: "https://app.authloop.ai/s/sess_123",
      streamToken: "tok_abc",
      livekitUrl: "wss://lk.authloop.ai",
      expiresAt: "2026-03-14T12:00:00Z",
    }),
    getSession: vi.fn().mockImplementation(() => {
      const status = pollSequence[Math.min(pollIndex, pollSequence.length - 1)];
      pollIndex++;
      return Promise.resolve({
        sessionId: "sess_123",
        status,
        service: "Test",
        createdAt: "c",
        expiresAt: "e",
      });
    }),
    resolveSession: vi.fn().mockResolvedValue(undefined),
    cancelSession: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  _resetActiveSession();
});

describe("runHandoff()", () => {
  it("creates session and returns session URL on resolution", async () => {
    const client = createMockClient();

    const result = await runHandoff(client as any, {
      service: "HDFC NetBanking",
      cdpUrl: "ws://localhost:9222",
      context: { blockerType: "otp", hint: "****1234" },
    });

    expect(client.handoff).toHaveBeenCalledWith({
      service: "HDFC NetBanking",
      cdpUrl: "ws://localhost:9222",
      context: { blockerType: "otp", hint: "****1234" },
    });
    expect(result.sessionUrl).toBe("https://app.authloop.ai/s/sess_123");
    expect(result.status).toBe("resolved");
  });

  it("calls resolveSession on successful resolution", async () => {
    const client = createMockClient();
    await runHandoff(client as any, { service: "Test", cdpUrl: "ws://x" });
    expect(client.resolveSession).toHaveBeenCalledWith("sess_123");
  });

  it("polls until ACTIVE before starting stream", async () => {
    vi.useFakeTimers();

    const client = createMockClient({
      pollSequence: ["PENDING", "PENDING", "ACTIVE"],
    });

    const promise = runHandoff(client as any, { service: "Test", cdpUrl: "ws://x" });

    // Advance past the two 3s poll delays
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(3000);

    const result = await promise;

    expect(client.getSession).toHaveBeenCalledTimes(3);
    expect(result.status).toBe("resolved");

    vi.useRealTimers();
  });

  it("returns error status when session goes to ERROR without streaming", async () => {
    const client = createMockClient({ pollSequence: ["ERROR"] });

    const result = await runHandoff(client as any, { service: "Test", cdpUrl: "ws://x" });

    expect(result.status).toBe("error");
  });

  it("returns resolved when session is already RESOLVED during polling", async () => {
    const client = createMockClient({ pollSequence: ["RESOLVED"] });

    const result = await runHandoff(client as any, { service: "Test", cdpUrl: "ws://x" });

    expect(result.status).toBe("resolved");
  });

  it("returns timeout status when session goes to TIMEOUT", async () => {
    const client = createMockClient({ pollSequence: ["TIMEOUT"] });

    const result = await runHandoff(client as any, { service: "Test", cdpUrl: "ws://x" });

    expect(result.status).toBe("timeout");
  });

  it("rejects concurrent handoffs", async () => {
    const client = createMockClient();

    // Slow down getSession so we can trigger concurrency
    client.getSession = vi.fn().mockImplementation(
      () => new Promise((resolve) =>
        setTimeout(() => resolve({
          sessionId: "s", status: "ACTIVE", service: "X", createdAt: "c", expiresAt: "e",
        }), 50),
      ),
    );

    const p1 = runHandoff(client as any, { service: "Test1", cdpUrl: "ws://x" });

    // Give p1 a moment to start
    await new Promise((r) => setTimeout(r, 10));

    await expect(
      runHandoff(client as any, { service: "Test2", cdpUrl: "ws://y" }),
    ).rejects.toThrow("already in progress");

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
