/**
 * Thin CDP WebSocket client. Uses native WebSocket (Node 22+).
 * Supports both direct WebSocket URLs (ws://, wss://) and HTTP-based CDP
 * endpoints (http://, https://) — auto-discovers the WebSocket debugger URL
 * via /json/version for HTTP endpoints.
 * No auto-reconnect — a CDP drop means the session is dead.
 */

import createDebug from "debug";

const debug = createDebug("authloop:cdp");

type PendingCall = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
};

type EventHandler = (params: Record<string, unknown>) => void;

/**
 * Resolves a CDP URL to a page-level WebSocket URL.
 * - ws:// / wss:// URLs are returned as-is (assumed to be a page target).
 * - http:// / https:// URLs are treated as CDP HTTP endpoints — we call
 *   /json to find the first "page" target and use its webSocketDebuggerUrl.
 *   Falls back to /json/version (browser-level) if no page targets exist.
 */
async function resolveWebSocketUrl(cdpUrl: string): Promise<string> {
  if (cdpUrl.startsWith("ws://") || cdpUrl.startsWith("wss://")) {
    debug("CDP URL is already WebSocket: %s", cdpUrl);
    return cdpUrl;
  }

  const base = cdpUrl.replace(/\/+$/, "");

  // Try /json first to get a page-level target (required for Page.startScreencast)
  try {
    const listUrl = `${base}/json`;
    debug("discovering page targets from %s", listUrl);
    const res = await fetch(listUrl);
    if (res.ok) {
      const targets = (await res.json()) as Array<{
        type?: string;
        webSocketDebuggerUrl?: string;
        url?: string;
        title?: string;
      }>;
      // Filter to page targets with WebSocket URLs
      const pages = targets.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
      // Prefer real web pages over chrome internal pages (about:, chrome:, chrome-extension:)
      const webPage = pages.find((t) => t.url && /^https?:\/\//.test(t.url));
      const page = webPage ?? pages[0];
      if (page) {
        debug("discovered page target: %s (%s)", page.title ?? page.url, page.webSocketDebuggerUrl);
        return page.webSocketDebuggerUrl!;
      }
      debug("no page targets found, falling back to /json/version");
    }
  } catch {
    debug("/json failed, falling back to /json/version");
  }

  // Fallback: browser-level endpoint
  const versionUrl = `${base}/json/version`;
  debug("discovering WebSocket URL from %s", versionUrl);
  const res = await fetch(versionUrl);
  if (!res.ok) {
    throw new Error(`CDP discovery failed: ${versionUrl} returned ${res.status}`);
  }

  const data = (await res.json()) as { webSocketDebuggerUrl?: string };
  if (!data.webSocketDebuggerUrl) {
    throw new Error(`CDP discovery: no webSocketDebuggerUrl in ${versionUrl} response`);
  }

  debug("discovered browser WebSocket URL: %s", data.webSocketDebuggerUrl);
  return data.webSocketDebuggerUrl;
}

export class CdpClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingCall>();
  private listeners = new Map<string, Set<EventHandler>>();
  private closeHandlers: Array<() => void> = [];
  private closed = false;

  constructor(private cdpUrl: string) {}

  /** Register a callback for when the CDP connection closes */
  onClose(handler: () => void): void {
    this.closeHandlers.push(handler);
  }

  async connect(): Promise<void> {
    const wsUrl = await resolveWebSocketUrl(this.cdpUrl);
    debug("connecting to %s", wsUrl);

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      ws.addEventListener("open", () => {
        debug("connected");
        resolve();
      });
      ws.addEventListener("error", (e) => {
        if (!this.closed) {
          debug("connection error: %s", (e as ErrorEvent).message ?? "unknown");
          reject(new Error(`CDP connection error: ${(e as ErrorEvent).message ?? "unknown"}`));
        }
      });

      ws.addEventListener("message", (event) => {
        const data = JSON.parse(String(event.data)) as {
          id?: number;
          method?: string;
          params?: Record<string, unknown>;
          result?: unknown;
          error?: { message: string };
        };

        // Response to a command
        if (data.id !== undefined) {
          const pending = this.pending.get(data.id);
          if (pending) {
            this.pending.delete(data.id);
            if (data.error) {
              debug("command %d error: %s", data.id, data.error.message);
              pending.reject(new Error(`CDP error: ${data.error.message}`));
            } else {
              debug("command %d ok", data.id);
              pending.resolve(data.result);
            }
          }
          return;
        }

        // Event
        if (data.method) {
          debug("event: %s", data.method);
          const handlers = this.listeners.get(data.method);
          if (handlers) {
            for (const handler of handlers) {
              handler(data.params ?? {});
            }
          }
        }
      });

      ws.addEventListener("close", () => {
        debug("connection closed, rejecting %d pending calls", this.pending.size);
        this.closed = true;
        for (const [, pending] of this.pending) {
          pending.reject(new Error("CDP connection closed"));
        }
        this.pending.clear();
        for (const handler of this.closeHandlers) {
          handler();
        }
      });
    });
  }

  send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.ws || this.closed) {
      return Promise.reject(new Error("CDP not connected"));
    }
    const id = this.nextId++;
    debug("send #%d %s", id, method);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws!.send(JSON.stringify({ id, method, params }));
    });
  }

  on(event: string, handler: EventHandler): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
  }

  close(): void {
    debug("closing, %d pending calls", this.pending.size);
    this.closed = true;
    for (const [, pending] of this.pending) {
      pending.reject(new Error("CDP client closed"));
    }
    this.pending.clear();
    this.ws?.close();
    this.ws = null;
  }
}
