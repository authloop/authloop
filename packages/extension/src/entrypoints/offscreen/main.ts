import { Room, LocalVideoTrack, RoomEvent } from 'livekit-client';

let room: Room | null = null;
let port: chrome.runtime.Port | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;

const enc = (o: object) => new TextEncoder().encode(JSON.stringify(o));
const dec = (d: Uint8Array) => JSON.parse(new TextDecoder().decode(d));

console.log('[authloop:offscreen] initializing');

// Connect to service worker via port
port = chrome.runtime.connect({ name: 'authloop-offscreen' });
console.log('[authloop:offscreen] port connected to service worker');

port.onMessage.addListener(handleMessage);
port.onDisconnect.addListener(() => {
  console.log('[authloop:offscreen] port disconnected');
  port = null;
  stopHeartbeat();
  room?.disconnect();
  room = null;
});

function startHeartbeat() {
  stopHeartbeat();
  heartbeat = setInterval(() => port?.postMessage({ type: 'HEARTBEAT' }), 25_000);
}

function stopHeartbeat() {
  if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
}

async function handleMessage(msg: any) {
  console.log('[authloop:offscreen] received:', msg.type);

  if (msg.type === 'START_LIVEKIT') {
    try {
      console.log('[authloop:offscreen] getUserMedia with streamId:', msg.streamId?.slice(0, 20) + '...');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          // @ts-ignore — Chrome-specific for tabCapture
          mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: msg.streamId }
        }
      });
      console.log('[authloop:offscreen] got MediaStream, tracks:', stream.getVideoTracks().length);

      room = new Room();
      console.log('[authloop:offscreen] connecting to LiveKit:', msg.livekitUrl);
      await room.connect(msg.livekitUrl, msg.livekitToken);
      console.log('[authloop:offscreen] LiveKit connected');

      const videoTrack = stream.getVideoTracks()[0];
      console.log('[authloop:offscreen] publishing video track:', videoTrack.label, videoTrack.readyState);
      // Bitrate tiers for screen content (text-heavy, needs clarity over motion)
      // WebRTC screen share best practices:
      //   720p  → 1.5-2.5 Mbps
      //   1080p → 2.5-4 Mbps
      //   1440p → 4-6 Mbps
      //   4K    → 6-8 Mbps
      const captureWidth = msg.cssWidth * msg.pixelRatio;
      const captureHeight = msg.cssHeight * msg.pixelRatio;
      const capturePixels = captureWidth * captureHeight;

      let bitrate: number;
      if (capturePixels <= 921_600)        bitrate = 2_000_000;   // ≤720p
      else if (capturePixels <= 2_073_600) bitrate = 3_500_000;   // ≤1080p
      else if (capturePixels <= 3_686_400) bitrate = 5_000_000;   // ≤1440p
      else                                 bitrate = 8_000_000;   // 4K / Retina

      // For auth pages (mostly static text), 15fps is sufficient and halves bandwidth
      const fps = 15;

      console.log('[authloop:offscreen] encoding:', captureWidth, 'x', captureHeight, '@', fps, 'fps,', (bitrate / 1_000_000).toFixed(1), 'Mbps');

      await room.localParticipant.publishTrack(
        new LocalVideoTrack(videoTrack), {
          name: `browser-${msg.sessionId}`,
          videoEncoding: { maxBitrate: bitrate, maxFramerate: fps },
          simulcast: false,
        }
      );
      console.log('[authloop:offscreen] video track published');

      // Broadcast STREAM_META
      room.localParticipant.publishData(enc({
        type: 'stream_meta',
        session_id: msg.sessionId,
        cssWidth: msg.cssWidth,
        cssHeight: msg.cssHeight,
        pixelRatio: msg.pixelRatio,
      }), { reliable: true });
      console.log('[authloop:offscreen] STREAM_META sent:', msg.cssWidth, 'x', msg.cssHeight, '@', msg.pixelRatio);

      // Forward input events from viewers to service worker
      room.on(RoomEvent.DataReceived, (payload: Uint8Array, participant) => {
        try {
          const m = dec(payload);
          console.log('[authloop:offscreen] data from viewer:', m.type, 'from:', participant?.identity);
          port?.postMessage({ ...m, _from: participant?.identity });
        } catch {}
      });

      // Track ended = tab closed
      videoTrack.addEventListener('ended', () => {
        console.log('[authloop:offscreen] video track ended (tab closed?)');
        port?.postMessage({ type: 'TRACK_ENDED', sessionId: msg.sessionId });
      });

      startHeartbeat();
      port?.postMessage({ type: 'LIVEKIT_CONNECTED', sessionId: msg.sessionId });
      console.log('[authloop:offscreen] streaming started successfully');
    } catch (e: any) {
      console.error('[authloop:offscreen] START_LIVEKIT failed:', e.message, e);
      port?.postMessage({ type: 'LIVEKIT_ERROR', sessionId: msg.sessionId, error: e.message });
    }
  }

  if (msg.type === 'RESIZE_STREAM' && room) {
    console.log('[authloop:offscreen] RESIZE_STREAM:', msg.cssWidth, 'x', msg.cssHeight);
    room.localParticipant.publishData(enc({
      type: 'stream_meta',
      session_id: msg.sessionId,
      cssWidth: msg.cssWidth,
      cssHeight: msg.cssHeight,
      pixelRatio: msg.pixelRatio,
    }), { reliable: true });
  }

  if (msg.type === 'STOP_LIVEKIT') {
    console.log('[authloop:offscreen] stopping LiveKit');
    stopHeartbeat();
    await room?.disconnect();
    room = null;
  }
}
