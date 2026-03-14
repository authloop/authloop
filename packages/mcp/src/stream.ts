/**
 * WebSocket + CDP bridge.
 * Captures browser screencast frames via CDP, sends them as binary JPEG over WebSocket.
 * Receives input events (clicks, keystrokes, scroll) from the human via WebSocket,
 * dispatches them to the browser via CDP.
 */

import createDebug from "debug";
import { CdpClient } from "./cdp.js";

const debug = createDebug("authloop:stream");

export type StreamResult = "resolved" | "error" | "timeout";

export class BrowserStream {
  private ws: WebSocket | null = null;
  private cdp: CdpClient | null = null;
  private resolveWait: ((result: StreamResult) => void) | null = null;
  private stopped = false;
  private frameCount = 0;

  constructor(
    private opts: {
      streamUrl: string;
      streamToken: string;
      cdpUrl: string;
    },
  ) {}

  async start(): Promise<void> {
    // 1. Connect to CDP
    debug("connecting to CDP: %s", this.opts.cdpUrl);
    this.cdp = new CdpClient(this.opts.cdpUrl);
    await this.cdp.connect();
    debug("CDP connected");

    // 2. Connect WebSocket to stream relay
    const wsUrl = `${this.opts.streamUrl}?token=${encodeURIComponent(this.opts.streamToken)}&role=agent`;
    debug("connecting to relay: %s", this.opts.streamUrl);
    await this.connectWebSocket(wsUrl);
    debug("relay connected");

    // 3. Listen for messages from the relay (input events + control)
    this.ws!.addEventListener("message", (event) => {
      if (this.stopped) return;
      if (typeof event.data === "string") {
        try {
          const msg = JSON.parse(event.data) as Record<string, unknown>;
          this.handleMessage(msg);
        } catch {
          debug("failed to parse message: %s", String(event.data).slice(0, 100));
        }
      }
    });

    this.ws!.addEventListener("close", () => {
      if (!this.stopped) {
        debug("relay WebSocket closed unexpectedly");
        this.resolveWait?.("error");
      }
    });

    // 4. Forward CDP screencast frames as binary JPEG
    this.cdp.on("Page.screencastFrame", (params: Record<string, unknown>) => {
      if (this.stopped) return;

      const sessionId = params.sessionId as number;
      const data = params.data as string;

      // ACK so CDP sends the next frame
      this.cdp?.send("Page.screencastFrameAck", { sessionId }).catch(() => {});

      // Send raw JPEG bytes over WebSocket
      if (this.ws?.readyState === WebSocket.OPEN) {
        const jpegBuffer = Buffer.from(data, "base64");
        this.ws.send(jpegBuffer);
        this.frameCount++;

        if (this.frameCount % 100 === 0) {
          debug("sent %d frames", this.frameCount);
        }
      }
    });

    // 5. Start screencast
    await this.cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 60,
      maxWidth: 1280,
      maxHeight: 720,
      everyNthFrame: 1,
    });
    debug("screencast started");
  }

  waitForResolution(): Promise<StreamResult> {
    return new Promise<StreamResult>((resolve) => {
      if (this.stopped) {
        resolve("error");
        return;
      }
      this.resolveWait = resolve;
    });
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    debug("stopping stream (sent %d frames)", this.frameCount);

    this.cdp?.send("Page.stopScreencast").catch(() => {});
    this.cdp?.close();
    this.cdp = null;

    this.ws?.close();
    this.ws = null;
    debug("stream stopped");
  }

  private async connectWebSocket(url: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("WebSocket connection timed out after 15s"));
      }, 15000);

      ws.addEventListener("open", () => {
        clearTimeout(timeout);
        resolve();
      });

      ws.addEventListener("error", (e) => {
        clearTimeout(timeout);
        reject(new Error(`WebSocket error: ${(e as ErrorEvent).message ?? "connection failed"}`));
      });
    });
  }

  private handleMessage(msg: Record<string, unknown>): void {
    const type = msg.type as string;
    debug("received: %s", type);

    switch (type) {
      case "click":
      case "dblclick":
        this.dispatchMouseClick(msg);
        break;
      case "keydown":
      case "keyup":
      case "keypress":
        this.dispatchKeyEvent(msg);
        break;
      case "scroll":
        this.dispatchScroll(msg);
        break;
      case "resolved":
        this.resolveWait?.("resolved");
        break;
      case "session_expired":
        debug("session expired");
        this.resolveWait?.("timeout");
        break;
      case "session_cancelled":
        debug("session cancelled");
        this.resolveWait?.("error");
        break;
      case "viewer_connected":
        debug("viewer connected");
        break;
      case "viewer_disconnected":
        debug("viewer disconnected");
        break;
    }
  }

  private dispatchMouseClick(msg: Record<string, unknown>): void {
    if (!this.cdp) return;
    const x = msg.x as number;
    const y = msg.y as number;
    const button = (msg.button as string) || "left";
    const clickCount = msg.type === "dblclick" ? 2 : 1;

    this.cdp
      .send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount })
      .then(() => this.cdp?.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount }))
      .catch(() => {});
  }

  private dispatchKeyEvent(msg: Record<string, unknown>): void {
    if (!this.cdp) return;
    const type = msg.type as string;
    const key = msg.key as string | undefined;
    const code = msg.code as string | undefined;

    if (type === "keypress") {
      // Character input
      this.cdp.send("Input.dispatchKeyEvent", { type: "char", text: key }).catch(() => {});
    } else if (type === "keydown") {
      this.cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code }).catch(() => {});
    } else if (type === "keyup") {
      this.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code }).catch(() => {});
    }
  }

  private dispatchScroll(msg: Record<string, unknown>): void {
    if (!this.cdp) return;
    const x = msg.x as number;
    const y = msg.y as number;
    const deltaX = (msg.deltaX as number) || 0;
    const deltaY = (msg.deltaY as number) || 0;

    this.cdp
      .send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX, deltaY })
      .catch(() => {});
  }
}
