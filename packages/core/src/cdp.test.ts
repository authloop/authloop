import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CdpClient } from "./cdp.js";

// Mock WebSocket
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  private handlers = new Map<string, Function[]>();
  readyState = 1;

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

  send(data: string) {
    // Store for assertions
    (this as any)._lastSent = JSON.parse(data);
  }

  close() {
    this.emit("close", {});
  }

  // Test helpers
  emit(event: string, data: any) {
    for (const h of this.handlers.get(event) ?? []) h(data);
  }

  simulateMessage(data: unknown) {
    this.emit("message", { data: JSON.stringify(data) });
  }
}

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal("WebSocket", MockWebSocket);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CdpClient", () => {
  it("connects to the provided URL", async () => {
    const client = new CdpClient("ws://localhost:9222");
    await client.connect();
    expect(MockWebSocket.instances[0].url).toBe("ws://localhost:9222");
    client.close();
  });

  it("sends commands with incrementing IDs", async () => {
    const client = new CdpClient("ws://localhost:9222");
    await client.connect();
    const ws = MockWebSocket.instances[0];

    // Send first command, simulate response
    const p1 = client.send("Page.startScreencast", { format: "jpeg" });
    expect((ws as any)._lastSent).toEqual({ id: 1, method: "Page.startScreencast", params: { format: "jpeg" } });
    ws.simulateMessage({ id: 1, result: { ok: true } });
    await expect(p1).resolves.toEqual({ ok: true });

    // Second command gets id 2
    const p2 = client.send("Page.stopScreencast");
    expect((ws as any)._lastSent.id).toBe(2);
    ws.simulateMessage({ id: 2, result: {} });
    await expect(p2).resolves.toEqual({});

    client.close();
  });

  it("rejects on CDP error response", async () => {
    const client = new CdpClient("ws://localhost:9222");
    await client.connect();
    const ws = MockWebSocket.instances[0];

    const p = client.send("Bad.method");
    ws.simulateMessage({ id: 1, error: { message: "Method not found" } });
    await expect(p).rejects.toThrow("CDP error: Method not found");

    client.close();
  });

  it("dispatches events to listeners", async () => {
    const client = new CdpClient("ws://localhost:9222");
    await client.connect();
    const ws = MockWebSocket.instances[0];

    const handler = vi.fn();
    client.on("Page.screencastFrame", handler);

    ws.simulateMessage({
      method: "Page.screencastFrame",
      params: { sessionId: 1, data: "base64data" },
    });

    expect(handler).toHaveBeenCalledWith({ sessionId: 1, data: "base64data" });

    client.close();
  });

  it("supports multiple listeners for same event", async () => {
    const client = new CdpClient("ws://localhost:9222");
    await client.connect();
    const ws = MockWebSocket.instances[0];

    const h1 = vi.fn();
    const h2 = vi.fn();
    client.on("Page.screencastFrame", h1);
    client.on("Page.screencastFrame", h2);

    ws.simulateMessage({ method: "Page.screencastFrame", params: { x: 1 } });

    expect(h1).toHaveBeenCalled();
    expect(h2).toHaveBeenCalled();

    client.close();
  });

  it("rejects pending calls on close", async () => {
    const client = new CdpClient("ws://localhost:9222");
    await client.connect();

    const p = client.send("Page.navigate", { url: "https://example.com" });
    client.close();

    await expect(p).rejects.toThrow("CDP client closed");
  });

  it("rejects pending calls on connection drop", async () => {
    const client = new CdpClient("ws://localhost:9222");
    await client.connect();
    const ws = MockWebSocket.instances[0];

    const p = client.send("Page.navigate", { url: "https://example.com" });
    ws.emit("close", {});

    await expect(p).rejects.toThrow("CDP connection closed");
  });

  it("rejects send after close", async () => {
    const client = new CdpClient("ws://localhost:9222");
    await client.connect();
    client.close();

    await expect(client.send("Page.navigate")).rejects.toThrow("CDP not connected");
  });
});
