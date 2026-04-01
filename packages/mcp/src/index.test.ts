import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuthLoop, AuthLoopError } from "@authloop-ai/sdk";

// Test that MCP's SDK usage patterns work correctly

describe("MCP SDK integration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("toHuman with cdpUrl succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            session_id: "sess_123",
            session_url: "https://authloop.ai/session/sess_123",
            stream_token: "tok_abc",
            stream_url: "wss://api.authloop.ai/stream/sess_123",
            expires_at: "2026-03-31T12:00:00Z",
          }),
      }),
    );

    const sdk = new AuthLoop({ apiKey: "al_test_key" });
    const result = await sdk.toHuman({ service: "Test Service", cdpUrl: "ws://localhost:9222" });

    expect(result.sessionId).toBe("sess_123");
    expect(result.streamToken).toBe("tok_abc");
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as any).body);
    expect(body.cdp_url).toBe("ws://localhost:9222");
  });

  it("handles extension_not_connected error (412)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 412,
        json: () =>
          Promise.resolve({
            error: "extension_not_connected",
            message: "Browser extension is not connected.",
          }),
      }),
    );

    const sdk = new AuthLoop({ apiKey: "al_test_key" });
    try {
      await sdk.toHuman({ service: "Test", cdpUrl: "ws://localhost:9222" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AuthLoopError);
      expect((e as AuthLoopError).code).toBe("extension_not_connected");
      expect((e as AuthLoopError).status).toBe(412);
    }
  });

  it("waitForResolution returns on RESOLVED", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            session_id: "sess_123",
            status: "RESOLVED",
            service: "X",
            created_at: "c",
            expires_at: "e",
          }),
      }),
    );

    const sdk = new AuthLoop({ apiKey: "al_test_key" });
    const result = await sdk.waitForResolution("sess_123");
    expect(result.status).toBe("RESOLVED");
  });

  it("waitForResolution returns on CANCELLED", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            session_id: "sess_456",
            status: "CANCELLED",
            service: "Y",
            created_at: "c",
            expires_at: "e",
          }),
      }),
    );

    const sdk = new AuthLoop({ apiKey: "al_test_key" });
    const result = await sdk.waitForResolution("sess_456");
    expect(result.status).toBe("CANCELLED");
  });

  it("waitForResolution returns on TIMEOUT", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            session_id: "sess_789",
            status: "TIMEOUT",
            service: "Z",
            created_at: "c",
            expires_at: "e",
          }),
      }),
    );

    const sdk = new AuthLoop({ apiKey: "al_test_key" });
    const result = await sdk.waitForResolution("sess_789");
    expect(result.status).toBe("TIMEOUT");
  });

  it("toHuman sends context fields correctly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            session_id: "sess_ctx",
            session_url: "https://authloop.ai/session/sess_ctx",
            stream_token: "tok_abc",
            stream_url: "wss://api.authloop.ai/stream/sess_123",
            expires_at: "2026-03-31T12:00:00Z",
          }),
      }),
    );

    const sdk = new AuthLoop({ apiKey: "al_test_key" });
    await sdk.toHuman({
      service: "HDFC NetBanking",
      context: {
        url: "https://hdfc.example.com/login",
        blockerType: "otp",
        hint: "OTP sent to ****1234",
      },
    });

    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as any).body);
    expect(body.service).toBe("HDFC NetBanking");
    expect(body.context.blocker_type).toBe("otp");
    expect(body.context.hint).toBe("OTP sent to ****1234");
    expect(body.context.url).toBe("https://hdfc.example.com/login");
  });

  it("toHuman sends Authorization header", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            session_id: "sess_auth",
            session_url: "https://authloop.ai/session/sess_auth",
            stream_token: "tok_abc",
            stream_url: "wss://api.authloop.ai/stream/sess_123",
            expires_at: "2026-03-31T12:00:00Z",
          }),
      }),
    );

    const sdk = new AuthLoop({ apiKey: "al_live_secret123" });
    await sdk.toHuman({ service: "Test", cdpUrl: "ws://localhost:9222" });

    const headers = (vi.mocked(fetch).mock.calls[0][1] as any).headers;
    expect(headers.Authorization).toBe("Bearer al_live_secret123");
  });

  it("handles 401 unauthorized error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () =>
          Promise.resolve({
            error: "unauthorized",
            message: "Invalid API key",
          }),
      }),
    );

    const sdk = new AuthLoop({ apiKey: "al_bad_key" });
    try {
      await sdk.toHuman({ service: "Test", cdpUrl: "ws://localhost:9222" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AuthLoopError);
      expect((e as AuthLoopError).status).toBe(401);
      expect((e as AuthLoopError).code).toBe("unauthorized");
    }
  });
});
