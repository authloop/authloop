import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuthLoop, AuthLoopError } from "./index.js";

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

describe("AuthLoop", () => {
  const authloop = new AuthLoop({ apiKey: "al_test_key" });

  describe("constructor", () => {
    it("uses default base URL", () => {
      const c = new AuthLoop({ apiKey: "k" });
      const spy = mockFetch(200, { session_id: "s1", session_url: "u", capture: "extension", expires_at: "e" });
      vi.stubGlobal("fetch", spy);
      c.toHuman({ service: "test" });
      expect(spy).toHaveBeenCalledWith("https://api.authloop.ai/session", expect.anything());
    });

    it("uses custom base URL", () => {
      const c = new AuthLoop({ apiKey: "k", baseUrl: "http://localhost:8787" });
      const spy = mockFetch(200, { session_id: "s1", session_url: "u", capture: "extension", expires_at: "e" });
      vi.stubGlobal("fetch", spy);
      c.toHuman({ service: "test" });
      expect(spy).toHaveBeenCalledWith("http://localhost:8787/session", expect.anything());
    });
  });

  describe("toHuman()", () => {
    it("sends correct request body with snake_case keys", async () => {
      const spy = mockFetch(200, {
        session_id: "sess_123",
        session_url: "https://app.authloop.ai/s/sess_123",
        capture: "extension",
        expires_at: "2026-03-14T12:00:00Z",
      });
      vi.stubGlobal("fetch", spy);

      await authloop.toHuman({
        service: "HDFC NetBanking",
        ttl: 300,
        context: { url: "https://hdfc.com", blockerType: "otp", hint: "OTP sent to ****1234" },
      });

      const [, init] = spy.mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body).toEqual({
        service: "HDFC NetBanking",
        ttl: 300,
        context: { url: "https://hdfc.com", blocker_type: "otp", hint: "OTP sent to ****1234" },
      });
      expect(init.headers.Authorization).toBe("Bearer al_test_key");
      expect(init.headers["Content-Type"]).toBe("application/json");
    });

    it("returns camelCase result with capture field", async () => {
      vi.stubGlobal("fetch", mockFetch(200, {
        session_id: "sess_123",
        session_url: "https://app.authloop.ai/s/sess_123",
        capture: "extension",
        expires_at: "2026-03-14T12:00:00Z",
      }));

      const result = await authloop.toHuman({ service: "Test" });

      expect(result).toEqual({
        sessionId: "sess_123",
        sessionUrl: "https://app.authloop.ai/s/sess_123",
        capture: "extension",
        expiresAt: "2026-03-14T12:00:00Z",
      });
    });

    it("does not send cdpUrl (removed in v2)", async () => {
      const spy = mockFetch(200, {
        session_id: "s", session_url: "u", capture: "extension", expires_at: "e",
      });
      vi.stubGlobal("fetch", spy);

      await authloop.toHuman({ service: "Test" });

      const body = JSON.parse(spy.mock.calls[0][1].body);
      expect(body.cdp_url).toBeUndefined();
    });

    it("omits context when not provided", async () => {
      const spy = mockFetch(200, {
        session_id: "s", session_url: "u", capture: "extension", expires_at: "e",
      });
      vi.stubGlobal("fetch", spy);

      await authloop.toHuman({ service: "Test" });

      const body = JSON.parse(spy.mock.calls[0][1].body);
      expect(body.context).toBeUndefined();
    });

    it("throws AuthLoopError on API error", async () => {
      vi.stubGlobal("fetch", mockFetch(401, { error: "invalid_api_key" }));

      await expect(authloop.toHuman({ service: "Test" }))
        .rejects.toThrow(AuthLoopError);

      try {
        await authloop.toHuman({ service: "Test" });
      } catch (e) {
        expect(e).toBeInstanceOf(AuthLoopError);
        expect((e as AuthLoopError).status).toBe(401);
        expect((e as AuthLoopError).code).toBe("invalid_api_key");
      }
    });

    it("includes detail message from API on extension_not_connected", async () => {
      vi.stubGlobal("fetch", mockFetch(412, {
        error: "extension_not_connected",
        message: "Browser extension is not connected.",
      }));

      try {
        await authloop.toHuman({ service: "Test" });
      } catch (e) {
        expect((e as AuthLoopError).status).toBe(412);
        expect((e as AuthLoopError).code).toBe("extension_not_connected");
        expect((e as AuthLoopError).detail).toBe("Browser extension is not connected.");
      }
    });

    it("handles non-JSON error response", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error("not json")),
      }));

      await expect(authloop.toHuman({ service: "Test" }))
        .rejects.toThrow(AuthLoopError);

      try {
        await authloop.toHuman({ service: "Test" });
      } catch (e) {
        expect((e as AuthLoopError).code).toBe("request_failed");
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

      const result = await authloop.getSession("sess_123");

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

      await authloop.getSession("sess_456");

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

      await authloop.cancelSession("sess_123");

      expect(spy).toHaveBeenCalledWith(
        "https://api.authloop.ai/session/sess_123",
        expect.objectContaining({ method: "DELETE" }),
      );
    });

    it("throws on error", async () => {
      vi.stubGlobal("fetch", mockFetch(404, { error: "session_not_found" }));
      await expect(authloop.cancelSession("bad")).rejects.toThrow(AuthLoopError);
    });
  });

  describe("resolveSession()", () => {
    it("sends POST to resolve endpoint", async () => {
      const spy = mockFetch(200, {});
      vi.stubGlobal("fetch", spy);

      await authloop.resolveSession("sess_123");

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

      const result = await authloop.waitForResolution("sess_123");
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

      const result = await authloop.waitForResolution("sess_123", { pollInterval: 10 });
      expect(result.status).toBe("RESOLVED");
      expect(callCount).toBe(3);
    });

    it("returns on ERROR status", async () => {
      vi.stubGlobal("fetch", mockFetch(200, {
        session_id: "sess_123", status: "ERROR", service: "X",
        created_at: "c", expires_at: "e",
      }));

      const result = await authloop.waitForResolution("sess_123");
      expect(result.status).toBe("ERROR");
    });

    it("throws on poll timeout", async () => {
      vi.stubGlobal("fetch", mockFetch(200, {
        session_id: "sess_123", status: "PENDING", service: "X",
        created_at: "c", expires_at: "e",
      }));

      await expect(
        authloop.waitForResolution("sess_123", { pollInterval: 10, timeout: 50 }),
      ).rejects.toThrow(AuthLoopError);
    });
  });
});

describe("AuthLoopError", () => {
  it("has correct properties", () => {
    const err = new AuthLoopError(402, "quota_exceeded");
    expect(err.status).toBe(402);
    expect(err.code).toBe("quota_exceeded");
    expect(err.name).toBe("AuthLoopError");
    expect(err.message).toContain("quota_exceeded");
    expect(err.message).toContain("402");
    expect(err).toBeInstanceOf(Error);
  });

  it("includes detail message when provided", () => {
    const err = new AuthLoopError(412, "extension_not_connected", "Install the extension.");
    expect(err.detail).toBe("Install the extension.");
    expect(err.message).toBe("Install the extension.");
  });
});
