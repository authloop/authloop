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
  status: "PENDING" | "ACTIVE" | "RESOLVED" | "TIMEOUT" | "ERROR";
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
  }

  async handoff(options: HandoffOptions): Promise<HandoffResult> {
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

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new AuthloopError(res.status, (body as Record<string, string>).error ?? "request_failed");
    }

    const data = (await res.json()) as Record<string, string>;
    return {
      sessionId: data.session_id!,
      sessionUrl: data.session_url!,
      streamToken: data.stream_token!,
      streamUrl: data.stream_url!,
      expiresAt: data.expires_at!,
    };
  }

  async getSession(sessionId: string): Promise<SessionStatus> {
    const res = await fetch(`${this.baseUrl}/session/${sessionId}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new AuthloopError(res.status, (body as Record<string, string>).error ?? "request_failed");
    }

    const data = (await res.json()) as Record<string, unknown>;
    return {
      sessionId: data.session_id as string,
      status: data.status as SessionStatus["status"],
      service: data.service as string,
      context: data.context as SessionStatus["context"],
      createdAt: data.created_at as string,
      expiresAt: data.expires_at as string,
    };
  }

  async cancelSession(sessionId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/session/${sessionId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new AuthloopError(res.status, (body as Record<string, string>).error ?? "request_failed");
    }
  }

  async resolveSession(sessionId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/session/${sessionId}/resolve`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new AuthloopError(res.status, (body as Record<string, string>).error ?? "request_failed");
    }
  }

  async waitForResolution(
    sessionId: string,
    options?: { pollInterval?: number; timeout?: number },
  ): Promise<SessionStatus> {
    const interval = options?.pollInterval ?? 3000;
    const timeout = options?.timeout ?? 600000;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const status = await this.getSession(sessionId);

      if (status.status === "RESOLVED" || status.status === "ERROR" || status.status === "TIMEOUT") {
        return status;
      }

      await new Promise((resolve) => setTimeout(resolve, interval));
    }

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
