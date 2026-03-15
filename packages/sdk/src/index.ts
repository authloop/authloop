import createDebug from "debug";

const debug = createDebug("authloop:sdk");
const debugHttp = createDebug("authloop:sdk:http");
const perf = createDebug("authloop:perf");

export interface AuthloopConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface HandoffOptions {
  service: string;
  cdpUrl: string;
  ttl?: number;
  context?: {
    url?: string;
    blockerType?: "otp" | "password" | "captcha" | "security_question" | "document_upload" | "other";
    hint?: string;
  };
}

export interface HandoffResult {
  sessionId: string;
  sessionUrl: string;
  streamToken: string;
  streamUrl: string;
  expiresAt: string;
}

export interface SessionStatus {
  sessionId: string;
  status: "PENDING" | "ACTIVE" | "RESOLVED" | "TIMEOUT" | "ERROR" | "CANCELLED";
  service: string;
  context?: {
    url?: string;
    blocker_type?: "otp" | "password" | "captcha" | "security_question" | "document_upload" | "other";
    hint?: string;
  };
  createdAt: string;
  expiresAt: string;
}

export class Authloop {
  private apiKey: string;
  private baseUrl: string;

  constructor(config: AuthloopConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? "https://api.authloop.ai";
    debug("initialized with baseUrl=%s", this.baseUrl);
  }

  async handoff(options: HandoffOptions): Promise<HandoffResult> {
    debug("handoff: service=%s cdpUrl=%s", options.service, options.cdpUrl);
    debugHttp("POST %s/session", this.baseUrl);

    const t0 = Date.now();
    const res = await fetch(`${this.baseUrl}/session`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        service: options.service,
        cdp_url: options.cdpUrl,
        ttl: options.ttl,
        context: options.context
          ? {
              url: options.context.url,
              blocker_type: options.context.blockerType,
              hint: options.context.hint,
            }
          : undefined,
      }),
    });

    perf("[perf:sdk] POST /session: %dms (status %d)", Date.now() - t0, res.status);
    debugHttp("POST /session → %d", res.status);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const code = (body as Record<string, string>).error ?? "request_failed";
      debug("handoff failed: %d %s", res.status, code);
      throw new AuthloopError(res.status, code);
    }

    const data = (await res.json()) as Record<string, string>;
    const result = {
      sessionId: data.session_id!,
      sessionUrl: data.session_url!,
      streamToken: data.stream_token!,
      streamUrl: data.stream_url!,
      expiresAt: data.expires_at!,
    };

    debug("handoff created: sessionId=%s expiresAt=%s", result.sessionId, result.expiresAt);
    return result;
  }

  async getSession(sessionId: string): Promise<SessionStatus> {
    debugHttp("GET %s/session/%s", this.baseUrl, sessionId);

    const t0 = Date.now();
    const res = await fetch(`${this.baseUrl}/session/${sessionId}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });

    perf("[perf:sdk] GET /session/%s: %dms (status %d)", sessionId, Date.now() - t0, res.status);
    debugHttp("GET /session/%s → %d", sessionId, res.status);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const code = (body as Record<string, string>).error ?? "request_failed";
      debug("getSession failed: %d %s", res.status, code);
      throw new AuthloopError(res.status, code);
    }

    const data = (await res.json()) as Record<string, unknown>;
    const result = {
      sessionId: data.session_id as string,
      status: data.status as SessionStatus["status"],
      service: data.service as string,
      context: data.context as SessionStatus["context"],
      createdAt: data.created_at as string,
      expiresAt: data.expires_at as string,
    };

    debug("getSession: sessionId=%s status=%s", result.sessionId, result.status);
    return result;
  }

  async cancelSession(sessionId: string): Promise<void> {
    debug("cancelSession: sessionId=%s", sessionId);
    debugHttp("DELETE %s/session/%s", this.baseUrl, sessionId);

    const t0 = Date.now();
    const res = await fetch(`${this.baseUrl}/session/${sessionId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });

    perf("[perf:sdk] DELETE /session/%s: %dms (status %d)", sessionId, Date.now() - t0, res.status);
    debugHttp("DELETE /session/%s → %d", sessionId, res.status);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const code = (body as Record<string, string>).error ?? "request_failed";
      debug("cancelSession failed: %d %s", res.status, code);
      throw new AuthloopError(res.status, code);
    }

    debug("cancelSession: done");
  }

  async resolveSession(sessionId: string): Promise<void> {
    debug("resolveSession: sessionId=%s", sessionId);
    debugHttp("POST %s/session/%s/resolve", this.baseUrl, sessionId);

    const t0 = Date.now();
    const res = await fetch(`${this.baseUrl}/session/${sessionId}/resolve`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });

    perf("[perf:sdk] POST /session/%s/resolve: %dms (status %d)", sessionId, Date.now() - t0, res.status);
    debugHttp("POST /session/%s/resolve → %d", sessionId, res.status);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const code = (body as Record<string, string>).error ?? "request_failed";
      debug("resolveSession failed: %d %s", res.status, code);
      throw new AuthloopError(res.status, code);
    }

    debug("resolveSession: done");
  }

  async waitForResolution(
    sessionId: string,
    options?: { pollInterval?: number; timeout?: number },
  ): Promise<SessionStatus> {
    const interval = options?.pollInterval ?? 3000;
    const timeout = options?.timeout ?? 600000;
    const start = Date.now();

    debug("waitForResolution: sessionId=%s interval=%dms timeout=%dms", sessionId, interval, timeout);

    while (Date.now() - start < timeout) {
      const status = await this.getSession(sessionId);

      if (status.status === "RESOLVED" || status.status === "ERROR" || status.status === "TIMEOUT" || status.status === "CANCELLED") {
        debug("waitForResolution: terminal status=%s after %dms", status.status, Date.now() - start);
        return status;
      }

      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    debug("waitForResolution: poll timeout after %dms", Date.now() - start);
    throw new AuthloopError(408, "poll_timeout");
  }
}

export class AuthloopError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(`Authloop API error: ${code} (${status})`);
    this.name = "AuthloopError";
  }
}
