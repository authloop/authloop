/**
 * Thin CDP WebSocket client. Uses native WebSocket (Node 22+).
 * No auto-reconnect — a CDP drop means the session is dead.
 */

type PendingCall = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
};

type EventHandler = (params: Record<string, unknown>) => void;

export class CdpClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingCall>();
  private listeners = new Map<string, Set<EventHandler>>();
  private closed = false;

  constructor(private cdpUrl: string) {}

  async connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.cdpUrl);
      this.ws = ws;

      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", (e) => {
        if (!this.closed) {
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
              pending.reject(new Error(`CDP error: ${data.error.message}`));
            } else {
              pending.resolve(data.result);
            }
          }
          return;
        }

        // Event
        if (data.method) {
          const handlers = this.listeners.get(data.method);
          if (handlers) {
            for (const handler of handlers) {
              handler(data.params ?? {});
            }
          }
        }
      });

      ws.addEventListener("close", () => {
        this.closed = true;
        // Reject all pending calls
        for (const [, pending] of this.pending) {
          pending.reject(new Error("CDP connection closed"));
        }
        this.pending.clear();
      });
    });
  }

  send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.ws || this.closed) {
      return Promise.reject(new Error("CDP not connected"));
    }
    const id = this.nextId++;
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
    this.closed = true;
    for (const [, pending] of this.pending) {
      pending.reject(new Error("CDP client closed"));
    }
    this.pending.clear();
    this.ws?.close();
    this.ws = null;
  }
}
