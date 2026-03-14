import { describe, it, expect, vi, beforeEach } from "vitest";
import { Authloop, AuthloopError } from "./index.js";

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("Authloop", () => {
  const client = new Authloop({ apiKey: "al_test_key" });

  describe("constructor", () => {
    it("uses default base URL", () => {
      const c = new Authloop({ apiKey: "k" });
      // Verify by making a call and checking the URL
      const spy = mockFetch(200, { session_id: "s1", session_url: "u", stream_token: "t", stream_url: "lk", expires_at: "e" });
      vi.stubGlobal("fetch", spy);
      c.handoff({ service: "test", cdpUrl: "ws://x" });
      expect(spy).toHaveBeenCalledWith("https://api.authloop.ai/session", expect.anything());
    });

    it("uses custom base URL", () => {
      const c = new Authloop({ apiKey: "k", baseUrl: "http://localhost:8787" });
      const spy = mockFetch(200, { session_id: "s1", session_url: "u", stream_token: "t", stream_url: "lk", expires_at: "e" });
      vi.stubGlobal("fetch", spy);
      c.handoff({ service: "test", cdpUrl: "ws://x" });
      expect(spy).toHaveBeenCalledWith("http://localhost:8787/session", expect.anything());
    });
  });

  describe("handoff()", () => {
    it("sends correct request body with snake_case keys", async () => {
      const spy = mockFetch(200, {
        session_id: "sess_123",
        session_url: "https://app.authloop.ai/s/sess_123",
        stream_token: "tok_abc",
        stream_url: "wss://lk.authloop.ai",
        expires_at: "2026-03-14T12:00:00Z",
      });
      vi.stubGlobal("fetch", spy);

      await client.handoff({
        service: "HDFC NetBanking",
        cdpUrl: "ws://localhost:9222",
        ttl: 300,
        context: { url: "https://hdfc.com", blockerType: "otp", hint: "OTP sent to ****1234" },
      });

      const [, init] = spy.mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body).toEqual({
        service: "HDFC NetBanking",
        cdp_url: "ws://localhost:9222",
        ttl: 300,
        context: { url: "https://hdfc.com", blocker_type: "otp", hint: "OTP sent to ****1234" },
      });
      expect(init.headers.Authorization).toBe("Bearer al_test_key");
      expect(init.headers["Content-Type"]).toBe("application/json");
    });

    it("returns camelCase result", async () => {
      vi.stubGlobal("fetch", mockFetch(200, {
        session_id: "sess_123",
        session_url: "https://app.authloop.ai/s/sess_123",
        stream_token: "tok_abc",
        stream_url: "wss://lk.authloop.ai",
        expires_at: "2026-03-14T12:00:00Z",
      }));

      const result = await client.handoff({ service: "Test", cdpUrl: "ws://x" });

      expect(result).toEqual({
        sessionId: "sess_123",
        sessionUrl: "https://app.authloop.ai/s/sess_123",
        streamToken: "tok_abc",
        streamUrl: "wss://lk.authloop.ai",
        expiresAt: "2026-03-14T12:00:00Z",
      });
    });

    it("omits context when not provided", async () => {
      const spy = mockFetch(200, {
        session_id: "s", session_url: "u", stream_token: "t", stream_url: "l", expires_at: "e",
      });
      vi.stubGlobal("fetch", spy);

      await client.handoff({ service: "Test", cdpUrl: "ws://x" });

      const body = JSON.parse(spy.mock.calls[0][1].body);
      expect(body.context).toBeUndefined();
    });

    it("throws AuthloopError on API error", async () => {
      vi.stubGlobal("fetch", mockFetch(401, { error: "invalid_api_key" }));

      await expect(client.handoff({ service: "Test", cdpUrl: "ws://x" }))
        .rejects.toThrow(AuthloopError);

      try {
        await client.handoff({ service: "Test", cdpUrl: "ws://x" });
      } catch (e) {
        expect(e).toBeInstanceOf(AuthloopError);
        expect((e as AuthloopError).status).toBe(401);
        expect((e as AuthloopError).code).toBe("invalid_api_key");
      }
    });

    it("handles non-JSON error response", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error("not json")),
      }));

      await expect(client.handoff({ service: "Test", cdpUrl: "ws://x" }))
        .rejects.toThrow(AuthloopError);

      try {
        await client.handoff({ service: "Test", cdpUrl: "ws://x" });
      } catch (e) {
        expect((e as AuthloopError).code).toBe("request_failed");
      }
    });
  });

  describe("getSession()", () => {
    it("returns mapped session status", async () => {
      vi.stubGlobal("fetch", mockFetch(200, {
        session_id: "sess_123",
        status: "ACTIVE",
        service: "HDFC",
        context: { blocker_type: "otp", hint: "****1234" },
        created_at: "2026-03-14T11:00:00Z",
        expires_at: "2026-03-14T12:00:00Z",
      }));

      const result = await client.getSession("sess_123");

      expect(result).toEqual({
        sessionId: "sess_123",
        status: "ACTIVE",
        service: "HDFC",
        context: { blocker_type: "otp", hint: "****1234" },
        createdAt: "2026-03-14T11:00:00Z",
        expiresAt: "2026-03-14T12:00:00Z",
      });
    });

    it("calls correct URL", async () => {
      const spy = mockFetch(200, {
        session_id: "sess_456", status: "PENDING", service: "X",
        created_at: "c", expires_at: "e",
      });
      vi.stubGlobal("fetch", spy);

      await client.getSession("sess_456");

      expect(spy).toHaveBeenCalledWith(
        "https://api.authloop.ai/session/sess_456",
        expect.objectContaining({ headers: { Authorization: "Bearer al_test_key" } }),
      );
    });
  });

  describe("cancelSession()", () => {
    it("sends DELETE request", async () => {
      const spy = mockFetch(204, {});
      vi.stubGlobal("fetch", spy);

      await client.cancelSession("sess_123");

      expect(spy).toHaveBeenCalledWith(
        "https://api.authloop.ai/session/sess_123",
        expect.objectContaining({ method: "DELETE" }),
      );
    });

    it("throws on error", async () => {
      vi.stubGlobal("fetch", mockFetch(404, { error: "session_not_found" }));
      await expect(client.cancelSession("bad")).rejects.toThrow(AuthloopError);
    });
  });

  describe("resolveSession()", () => {
    it("sends POST to resolve endpoint", async () => {
      const spy = mockFetch(200, {});
      vi.stubGlobal("fetch", spy);

      await client.resolveSession("sess_123");

      expect(spy).toHaveBeenCalledWith(
        "https://api.authloop.ai/session/sess_123/resolve",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  describe("waitForResolution()", () => {
    it("returns immediately on terminal status", async () => {
      vi.stubGlobal("fetch", mockFetch(200, {
        session_id: "sess_123", status: "RESOLVED", service: "X",
        created_at: "c", expires_at: "e",
      }));

      const result = await client.waitForResolution("sess_123");
      expect(result.status).toBe("RESOLVED");
    });

    it("polls until resolved", async () => {
      let callCount = 0;
      vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
        callCount++;
        const status = callCount >= 3 ? "RESOLVED" : "PENDING";
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            session_id: "sess_123", status, service: "X",
            created_at: "c", expires_at: "e",
          }),
        });
      }));

      const result = await client.waitForResolution("sess_123", { pollInterval: 10 });
      expect(result.status).toBe("RESOLVED");
      expect(callCount).toBe(3);
    });

    it("returns on ERROR status", async () => {
      vi.stubGlobal("fetch", mockFetch(200, {
        session_id: "sess_123", status: "ERROR", service: "X",
        created_at: "c", expires_at: "e",
      }));

      const result = await client.waitForResolution("sess_123");
      expect(result.status).toBe("ERROR");
    });

    it("throws on poll timeout", async () => {
      vi.stubGlobal("fetch", mockFetch(200, {
        session_id: "sess_123", status: "PENDING", service: "X",
        created_at: "c", expires_at: "e",
      }));

      await expect(
        client.waitForResolution("sess_123", { pollInterval: 10, timeout: 50 }),
      ).rejects.toThrow(AuthloopError);
    });
  });
});

describe("AuthloopError", () => {
  it("has correct properties", () => {
    const err = new AuthloopError(402, "quota_exceeded");
    expect(err.status).toBe(402);
    expect(err.code).toBe("quota_exceeded");
    expect(err.name).toBe("AuthloopError");
    expect(err.message).toContain("quota_exceeded");
    expect(err.message).toContain("402");
    expect(err).toBeInstanceOf(Error);
  });
});
