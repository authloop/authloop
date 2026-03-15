import { describe, it, expect, beforeAll } from "vitest";
import { Authloop, AuthloopError } from "../index.js";

const apiKey = process.env.AUTHLOOP_API_KEY;

describe.skipIf(!apiKey)("SDK integration tests (live API)", () => {
  let client: Authloop;

  beforeAll(() => {
    client = new Authloop({
      apiKey: apiKey!,
      baseUrl: process.env.AUTHLOOP_BASE_URL,
    });
  });

  it("creates a session and gets back all expected fields", async () => {
    const session = await client.handoff({
      service: "Integration Test",
      cdpUrl: "ws://localhost:9222",
      context: { blockerType: "otp", hint: "Test hint" },
    });

    expect(session.sessionId).toBeTruthy();
    expect(session.sessionUrl).toMatch(/^https?:\/\//);
    expect(session.streamToken).toBeTruthy();
    expect(session.streamUrl).toBeTruthy();
    expect(session.expiresAt).toBeTruthy();

    // Clean up
    await client.cancelSession(session.sessionId);
  });

  it("polls session status and sees PENDING", async () => {
    const session = await client.handoff({
      service: "Integration Test - Poll",
      cdpUrl: "ws://localhost:9222",
    });

    const status = await client.getSession(session.sessionId);

    expect(status.sessionId).toBe(session.sessionId);
    expect(status.status).toBe("PENDING");
    expect(status.service).toBe("Integration Test - Poll");
    expect(status.createdAt).toBeTruthy();
    expect(status.expiresAt).toBeTruthy();

    await client.cancelSession(session.sessionId);
  });

  it("cancels a session", async () => {
    const session = await client.handoff({
      service: "Integration Test - Cancel",
      cdpUrl: "ws://localhost:9222",
    });

    await expect(client.cancelSession(session.sessionId)).resolves.not.toThrow();
  });

  it("returns 404 when getting a non-existent session", async () => {
    try {
      await client.getSession("nonexistent_session_id");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AuthloopError);
      expect((e as AuthloopError).status).toBe(404);
    }
  });

  it("rejects or no-ops when resolving an already-cancelled session", async () => {
    const session = await client.handoff({
      service: "Integration Test - Resolve After Cancel",
      cdpUrl: "ws://localhost:9222",
    });

    await client.cancelSession(session.sessionId);

    // API may return 200 (idempotent) or 409 (already_terminal) depending on timing
    try {
      await client.resolveSession(session.sessionId);
      // If it didn't throw, the API accepted it — that's fine
    } catch (e) {
      expect(e).toBeInstanceOf(AuthloopError);
      expect((e as AuthloopError).status).toBe(409);
    }
  });

  it("creates a session with custom TTL", async () => {
    const session = await client.handoff({
      service: "Integration Test - TTL",
      cdpUrl: "ws://localhost:9222",
      ttl: 120,
    });

    expect(session.sessionId).toBeTruthy();

    const status = await client.getSession(session.sessionId);
    // Verify expiry is roughly 2 minutes from now, not 10
    const expiresAt = new Date(status.expiresAt).getTime();
    const now = Date.now();
    const diffSeconds = (expiresAt - now) / 1000;
    expect(diffSeconds).toBeLessThanOrEqual(120);
    expect(diffSeconds).toBeGreaterThan(60); // at least a minute left

    await client.cancelSession(session.sessionId);
  });

  it("returns context in session status", async () => {
    const session = await client.handoff({
      service: "Integration Test - Context",
      cdpUrl: "ws://localhost:9222",
      context: {
        url: "https://example.com/login",
        blockerType: "captcha",
        hint: "Solve the captcha",
      },
    });

    const status = await client.getSession(session.sessionId);

    expect(status.context).toBeDefined();
    expect(status.context?.blocker_type).toBe("captcha");
    expect(status.context?.hint).toBe("Solve the captcha");
    expect(status.context?.url).toBe("https://example.com/login");

    await client.cancelSession(session.sessionId);
  });

  it("returns CANCELLED status after cancelling a session", async () => {
    const session = await client.handoff({
      service: "Integration Test - Cancelled Status",
      cdpUrl: "ws://localhost:9222",
    });

    await client.cancelSession(session.sessionId);

    const status = await client.getSession(session.sessionId);
    expect(status.status).toBe("CANCELLED");
  });

  it("waitForResolution returns immediately on CANCELLED", async () => {
    const session = await client.handoff({
      service: "Integration Test - Wait Cancelled",
      cdpUrl: "ws://localhost:9222",
    });

    await client.cancelSession(session.sessionId);

    const status = await client.waitForResolution(session.sessionId, { pollInterval: 100 });
    expect(status.status).toBe("CANCELLED");
  });

  it("rejects with 401 on bad API key", async () => {
    const badClient = new Authloop({
      apiKey: "al_live_invalid_key",
      baseUrl: process.env.AUTHLOOP_BASE_URL,
    });

    try {
      await badClient.handoff({ service: "Test", cdpUrl: "ws://x" });
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AuthloopError);
      expect((e as AuthloopError).status).toBe(401);
    }
  });
});
