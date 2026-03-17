/**
 * Full E2E test: MCP → real API → real relay → real web app viewer
 *
 * Prerequisites:
 *   1. Chrome with CDP:     google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/authloop-test
 *   2. Run this:            AUTHLOOP_API_KEY=al_live_... node scripts/test-e2e-full.mjs
 *   3. Open the session URL printed below in your browser
 *
 * Flow:
 *   - Creates a real session via the API
 *   - Connects to the relay WebSocket immediately (no polling)
 *   - Waits for viewer_connected (you open the URL)
 *   - Starts CDP screencast + E2EE key exchange
 *   - Human interacts, clicks Done or Cancel
 *   - Calls resolve/cancel on the API
 */

import { AuthLoop } from "../packages/sdk/dist/index.js";
import { BrowserStream } from "../packages/core/dist/stream.js";

const apiKey = process.env.AUTHLOOP_API_KEY;
const baseUrl = process.env.AUTHLOOP_BASE_URL || "https://api.authloop.ai";
const cdpUrl = process.env.CDP_URL || "http://127.0.0.1:9222";

if (!apiKey) {
  console.error("AUTHLOOP_API_KEY is required");
  process.exit(1);
}

const authloop = new AuthLoop({ apiKey, baseUrl });

// Graceful shutdown
let stream = null;
let ws = null;
async function cleanup(result) {
  console.log("\nCleaning up...");
  await stream?.stop();
  if (!stream && ws) ws.close();
  console.log("Done. Result:", result ?? "interrupted");
  process.exit(0);
}
process.on("SIGINT", () => cleanup());
process.on("SIGTERM", () => cleanup());

console.log("=== AuthLoop Full E2E Test ===");
console.log("API:    ", baseUrl);
console.log("CDP:    ", cdpUrl);
console.log("");

// 1. Create session
console.log("Creating session...");
const session = await authloop.toHuman({
  service: "E2E Test",
  cdpUrl,
  context: { blockerType: "password", hint: "Full E2E test" },
});

console.log("");
console.log("╔══════════════════════════════════════════════════════╗");
console.log("║  Session created! Open this URL in your browser:    ║");
console.log("║                                                      ║");
console.log(`║  ${session.sessionUrl.padEnd(52)}║`);
console.log("║                                                      ║");
console.log("║  (or http://localhost:3000/session/" + session.sessionId + ")");
console.log("╚══════════════════════════════════════════════════════╝");
console.log("");

// 2. Connect WebSocket immediately (no polling)
console.log("Connecting to relay...");
const wsUrl = `${session.streamUrl}?token=${encodeURIComponent(session.streamToken)}&role=agent`;

ws = await new Promise((resolve, reject) => {
  const socket = new WebSocket(wsUrl);
  const timeout = setTimeout(() => { socket.close(); reject(new Error("WebSocket timeout")); }, 15000);
  socket.addEventListener("open", () => { clearTimeout(timeout); resolve(socket); });
  socket.addEventListener("error", (e) => { clearTimeout(timeout); reject(e); });
});

console.log("Relay connected. Waiting for viewer...\n");

// 3. Wait for viewer_connected or terminal event
const waitResult = await new Promise((resolve) => {
  ws.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "viewer_connected") resolve("active");
      if (msg.type === "session_expired") resolve("timeout");
      if (msg.type === "session_cancelled") resolve("cancelled");
    } catch {}
  });
  ws.addEventListener("close", () => resolve("error"));
});

if (waitResult !== "active") {
  console.log("Session terminated before viewer joined:", waitResult);
  ws.close();
  process.exit(1);
}

console.log("Viewer connected! Starting stream...");

// 4. Start stream — reuse the already-connected WebSocket
stream = new BrowserStream({ ws, cdpUrl });

await stream.start();
console.log("Stream started — browser is now live in the viewer.");
console.log("Interact with the browser, then click Done or Cancel.\n");

// 5. Wait for resolution
const result = await stream.waitForResolution();
console.log("Stream result:", result);

// 6. Tell the API
if (result === "resolved") {
  console.log("Resolving session...");
  await authloop.resolveSession(session.sessionId).catch(() => {});
} else if (result === "cancelled") {
  console.log("Cancelling session...");
  await authloop.cancelSession(session.sessionId).catch(() => {});
}

await cleanup(result);
