/**
 * LiveKit + CDP bridge.
 * Captures browser screencast frames via CDP, publishes them as a LiveKit video track.
 * Receives keystrokes from the human via LiveKit data channel, dispatches to browser via CDP.
 */

import createDebug from "debug";
import {
  Room,
  RoomEvent,
  LocalVideoTrack,
  VideoSource,
  VideoFrame,
  VideoBufferType,
  TrackPublishOptions,
} from "@livekit/rtc-node";
import { decode } from "jpeg-js";
import { CdpClient } from "./cdp.js";

const debug = createDebug("authloop:stream");

export type StreamResult = "resolved" | "error" | "timeout";

export class BrowserStream {
  private room: Room | null = null;
  private cdp: CdpClient | null = null;
  private videoSource: VideoSource | null = null;
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
    // Connect to CDP
    debug("connecting to CDP: %s", this.opts.cdpUrl);
    this.cdp = new CdpClient(this.opts.cdpUrl);
    await this.cdp.connect();
    debug("CDP connected");

    // Connect to LiveKit room
    debug("connecting to LiveKit: %s", this.opts.streamUrl);
    debug("stream token (first 20 chars): %s...", this.opts.streamToken.slice(0, 20));
    this.room = new Room();

    // Decode JWT payload for debugging (no validation, just inspect)
    try {
      const payload = JSON.parse(Buffer.from(this.opts.streamToken.split(".")[1], "base64url").toString());
      debug("token payload: room=%s sub=%s exp=%s", payload.video?.room, payload.sub, payload.exp ? new Date(payload.exp * 1000).toISOString() : "none");
    } catch {
      debug("could not decode token payload");
    }

    const connectTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("LiveKit connection timed out after 15s")), 15000),
    );

    try {
      await Promise.race([
        this.room.connect(this.opts.streamUrl, this.opts.streamToken),
        connectTimeout,
      ]);
    } catch (err) {
      debug("LiveKit connect failed: %s", (err as Error).message);
      throw err;
    }
    debug("LiveKit connected");

    // Set up video source and publish track
    this.videoSource = new VideoSource(1280, 720);
    const track = LocalVideoTrack.createVideoTrack("screen", this.videoSource);
    await this.room.localParticipant!.publishTrack(track, new TrackPublishOptions());
    debug("video track published");

    // Listen for keystrokes from human via data channel
    this.room.on(
      RoomEvent.DataReceived,
      (payload: Uint8Array, _participant, _kind, topic) => {
        if (this.stopped) return;

        const message = JSON.parse(new TextDecoder().decode(payload)) as Record<string, unknown>;

        if (topic === "keystrokes") {
          debug("keystroke received: type=%s key=%s", message.type, message.key);
          this.handleKeystroke(message);
        }

        if (message.type === "resolved") {
          debug("resolution signal received");
          this.resolveWait?.("resolved");
        }
      },
    );

    // Listen for CDP screencast frames
    this.cdp.on(
      "Page.screencastFrame",
      (params: Record<string, unknown>) => {
        if (this.stopped) return;

        const sessionId = params.sessionId as number;
        const data = params.data as string;
        const metadata = params.metadata as { deviceWidth?: number; deviceHeight?: number } | undefined;

        // Ack the frame to keep receiving
        this.cdp?.send("Page.screencastFrameAck", { sessionId }).catch(() => {});

        // Decode JPEG and publish as video frame
        this.publishFrame(data, metadata?.deviceWidth, metadata?.deviceHeight);
      },
    );

    // Start screencast
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
    debug("stopping stream (published %d frames)", this.frameCount);

    try {
      await this.cdp?.send("Page.stopScreencast").catch(() => {});
    } catch {
      // ignore
    }

    this.cdp?.close();
    this.cdp = null;

    await this.videoSource?.close();
    this.videoSource = null;

    await this.room?.disconnect();
    this.room = null;
    debug("stream stopped");
  }

  private publishFrame(base64Data: string, width?: number, height?: number): void {
    if (!this.videoSource || this.stopped) return;

    try {
      const jpegBuffer = Buffer.from(base64Data, "base64");
      const decoded = decode(jpegBuffer, { useTArray: true });

      const frameWidth = width ?? decoded.width;
      const frameHeight = height ?? decoded.height;

      const frame = new VideoFrame(
        new Uint8Array(decoded.data),
        frameWidth,
        frameHeight,
        VideoBufferType.RGBA,
      );
      this.videoSource.captureFrame(frame);
      this.frameCount++;

      if (this.frameCount % 100 === 0) {
        debug("published %d frames", this.frameCount);
      }
    } catch {
      // Skip malformed frames
    }
  }

  private handleKeystroke(message: Record<string, unknown>): void {
    if (!this.cdp) return;

    const type = message.type as string;
    const key = message.key as string | undefined;
    const code = message.code as string | undefined;
    const text = message.text as string | undefined;

    // Map to CDP Input.dispatchKeyEvent
    const cdpType = type === "keydown" ? "keyDown" : type === "keyup" ? "keyUp" : "char";

    this.cdp
      .send("Input.dispatchKeyEvent", {
        type: cdpType,
        key,
        code,
        text: text ?? (cdpType === "char" ? key : undefined),
      })
      .catch(() => {});
  }
}
