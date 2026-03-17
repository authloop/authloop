/**
 * WebSocket + CDP bridge.
 * Captures browser screencast frames via CDP, sends them as binary JPEG over WebSocket.
 * Receives input events (clicks, keystrokes, scroll) from the human via WebSocket,
 * dispatches them to the browser via CDP.
 *
 * The WebSocket is pre-connected by session.ts and passed in — this class does not
 * manage the WebSocket connection lifecycle.
 */

import createDebug from "debug";
import { CdpClient } from "./cdp.js";
import { E2EESession } from "./crypto.js";

const debug = createDebug("authloop:stream");
const perf = createDebug("authloop:perf");

/** Windows virtual key codes for CDP Input.dispatchKeyEvent */
const KEY_CODES: Record<string, number> = {
  Backspace: 8, Tab: 9, Enter: 13, Shift: 16, Control: 17, Alt: 18,
  Escape: 27, " ": 32, PageUp: 33, PageDown: 34, End: 35, Home: 36,
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
  Insert: 45, Delete: 46,
  Meta: 91, ContextMenu: 93,
  F1: 112, F2: 113, F3: 114, F4: 115, F5: 116, F6: 117,
  F7: 118, F8: 119, F9: 120, F10: 121, F11: 122, F12: 123,
};

export type StreamResult = "resolved" | "cancelled" | "error" | "timeout";

export class BrowserStream {
  private ws: WebSocket;
  private cdp: CdpClient | null = null;
  private e2ee = new E2EESession();
  private resolveWait: ((result: StreamResult) => void) | null = null;
  private stopped = false;
  private frameCount = 0;
  private lastFrameData: { meta: string; jpeg: Buffer } | null = null;
  private startTime = 0;
  private firstFrameSent = false;

  constructor(
    private opts: {
      ws: WebSocket;
      cdpUrl: string;
    },
  ) {
    this.ws = opts.ws;
  }

  async start(): Promise<void> {
    this.startTime = Date.now();

    // 1. Connect to CDP
    debug("connecting to CDP: %s", this.opts.cdpUrl);
    let t0 = Date.now();
    this.cdp = new CdpClient(this.opts.cdpUrl);
    this.cdp.onClose(() => {
      if (!this.stopped) {
        debug("CDP disconnected unexpectedly");
        this.resolveWait?.("error");
      }
    });
    await this.cdp.connect();
    perf("[perf:stream] CDP connect: %dms", Date.now() - t0);
    debug("CDP connected");

    // 2. Send our E2EE public key so the viewer can derive the shared secret
    this.ws.send(JSON.stringify({ type: "pubkey", key: this.e2ee.publicKey }));
    debug("sent E2EE public key");

    // 3. Listen for messages from the relay (input events + control)
    this.ws.addEventListener("message", (event) => {
      if (this.stopped) return;
      if (typeof event.data === "string") {
        try {
          const msg = JSON.parse(event.data) as Record<string, unknown>;
          this.handleMessage(msg);
        } catch {
          debug("failed to parse message (dropped)");
        }
      }
    });

    this.ws.addEventListener("close", () => {
      if (!this.stopped) {
        debug("relay WebSocket closed unexpectedly");
        this.resolveWait?.("error");
      }
    });

    // 4. Forward CDP screencast frames as binary JPEG with metadata header
    this.cdp.on("Page.screencastFrame", (params: Record<string, unknown>) => {
      if (this.stopped) return;

      const sessionId = params.sessionId as number;
      const data = params.data as string;
      const metadata = params.metadata as {
        offsetTop?: number;
        pageScaleFactor?: number;
        deviceWidth?: number;
        deviceHeight?: number;
        scrollOffsetX?: number;
        scrollOffsetY?: number;
      } | undefined;

      // ACK so CDP sends the next frame
      this.cdp?.send("Page.screencastFrameAck", { sessionId }).catch(() => {});

      // Send frame with metadata as a JSON message, then binary JPEG
      const jpegBuffer = Buffer.from(data, "base64");
      const metaJson = JSON.stringify({
        type: "frame",
        deviceWidth: metadata?.deviceWidth,
        deviceHeight: metadata?.deviceHeight,
        offsetTop: metadata?.offsetTop ?? 0,
        pageScaleFactor: metadata?.pageScaleFactor ?? 1,
        scrollOffsetX: metadata?.scrollOffsetX ?? 0,
        scrollOffsetY: metadata?.scrollOffsetY ?? 0,
        jpegSize: jpegBuffer.byteLength,
      });

      // Cache latest frame so we can send it when a viewer connects
      this.lastFrameData = { meta: metaJson, jpeg: jpegBuffer };

      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(metaJson);
        this.ws.send(jpegBuffer);

        this.frameCount++;

        if (!this.firstFrameSent) {
          this.firstFrameSent = true;
          const frameTime = Date.now();
          perf("[perf:stream] CDP → first screencast frame: %dms", frameTime - this.startTime);
          perf("[perf:stream] first frame → first relay send: %dms", Date.now() - frameTime);
        }

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
    perf("[perf:stream] total start() time: %dms", Date.now() - this.startTime);
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
    perf("[perf:stream] frames published: %d", this.frameCount);
    perf("[perf:stream] session duration: %ds", Math.round((Date.now() - this.startTime) / 1000));

    this.cdp?.send("Page.stopScreencast").catch(() => {});
    this.cdp?.close();
    this.cdp = null;

    this.ws.close();
    debug("stream stopped");
  }

  private handleMessage(msg: Record<string, unknown>): void {
    const type = msg.type as string;

    // Handle E2EE key exchange
    if (type === "pubkey") {
      debug("received viewer public key, deriving shared secret");
      this.e2ee.deriveSecret(msg.key as string);
      perf("[perf:stream] E2EE key exchange: %dms", Date.now() - this.startTime);
      return;
    }

    // Handle encrypted messages — decrypt then process as normal
    if (type === "encrypted") {
      if (!this.e2ee.ready) {
        debug("received encrypted message but E2EE not ready, dropping");
        return;
      }
      try {
        const plaintext = this.e2ee.decrypt(msg.payload as { iv: string; ciphertext: string; tag: string });
        const decrypted = JSON.parse(plaintext) as Record<string, unknown>;
        debug("decrypted: %s", decrypted.type);
        this.handleMessage(decrypted);
      } catch (err) {
        debug("decryption failed: %s", (err as Error).message);
      }
      return;
    }

    // Control messages from the relay (always plaintext)
    switch (type) {
      case "session_expired":
        debug("session expired");
        this.resolveWait?.("timeout");
        return;
      case "session_cancelled":
        debug("session cancelled");
        this.resolveWait?.("cancelled");
        return;
      case "viewer_connected":
        debug("viewer connected");
        if (this.lastFrameData && this.ws.readyState === WebSocket.OPEN) {
          debug("sending cached frame to new viewer");
          this.ws.send(this.lastFrameData.meta);
          this.ws.send(this.lastFrameData.jpeg);
        }
        return;
      case "viewer_disconnected":
        debug("viewer disconnected");
        return;
    }

    // Input events — must be decrypted (no plaintext fallback)
    // These arrive only after E2EE decrypt (recursive handleMessage call)
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
      case "paste":
        this.dispatchPaste(msg);
        break;
      case "back":
        debug("navigate back");
        this.cdp?.send("Runtime.evaluate", { expression: "history.back()" }).catch(() => {});
        break;
      case "forward":
        debug("navigate forward");
        this.cdp?.send("Runtime.evaluate", { expression: "history.forward()" }).catch(() => {});
        break;
      case "reload":
        debug("reload page");
        this.cdp?.send("Page.reload").catch(() => {});
        break;
      case "resolved":
        debug("viewer marked auth as complete");
        this.resolveWait?.("resolved");
        break;
      case "cancelled":
        debug("viewer cancelled the session");
        this.resolveWait?.("cancelled");
        break;
      default:
        debug("unknown message type: %s (dropped)", type);
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
    const modifiers = this.getModifiers(msg);
    const keyCode = key ? KEY_CODES[key] ?? 0 : 0;

    if (type === "keypress") {
      // Printable character — send char only (viewer sends keyup separately)
      const text = key && key.length === 1 ? key : undefined;
      if (text) {
        this.cdp.send("Input.dispatchKeyEvent", {
          type: "char", text, modifiers,
        }).catch(() => {});
      }
    } else if (type === "keydown") {
      // Special keys (Backspace, Enter, arrows, etc.) or modified keys (Ctrl+A)
      const isModifiedPrintable = key && key.length === 1 && modifiers > 0;
      const text = isModifiedPrintable ? key : undefined;
      this.cdp.send("Input.dispatchKeyEvent", {
        type: "rawKeyDown", key, code, text, modifiers,
        windowsVirtualKeyCode: keyCode || (key && key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0),
        nativeVirtualKeyCode: keyCode || (key && key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0),
      }).catch(() => {});
    } else if (type === "keyup") {
      this.cdp.send("Input.dispatchKeyEvent", {
        type: "keyUp", key, code, modifiers,
        windowsVirtualKeyCode: keyCode || (key && key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0),
        nativeVirtualKeyCode: keyCode || (key && key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0),
      }).catch(() => {});
    }
  }

  /** Convert modifier flags to CDP bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8 */
  private getModifiers(msg: Record<string, unknown>): number {
    let m = 0;
    if (msg.altKey) m |= 1;
    if (msg.ctrlKey) m |= 2;
    if (msg.metaKey) m |= 4;
    if (msg.shiftKey) m |= 8;
    return m;
  }

  private dispatchPaste(msg: Record<string, unknown>): void {
    if (!this.cdp) return;
    const text = msg.text as string;
    if (text) {
      debug("paste: %d chars", text.length);
      this.cdp.send("Input.insertText", { text }).catch(() => {});
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
