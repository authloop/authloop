/**
 * Full E2E test: MCP → real API → real relay → real web app viewer
 *
 * Prerequisites:
 *   1. Chrome with CDP:     google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/authloop-test
 *   2. Local API server:    running on localhost:8787
 *   3. Local web app:       running on localhost:3000
 *   4. Run this:            AUTHLOOP_API_KEY=al_live_... node scripts/test-e2e-full.mjs
 *
 * Flow:
 *   - Creates a real session via the API
 *   - Prints the session URL — open it in your browser (localhost:3000)
 *   - Connects to the real relay WebSocket
 *   - Streams CDP screencast frames
 *   - E2EE key exchange with the real viewer
 *   - Human interacts, clicks Done or Cancel
 *   - Calls resolve/cancel on the API
 */

import { Authloop } from "../packages/sdk/dist/index.js";
import { BrowserStream } from "../packages/mcp/dist/stream.js";

const apiKey = process.env.AUTHLOOP_API_KEY;
const baseUrl = process.env.AUTHLOOP_BASE_URL || "https://api.authloop.ai";
const cdpUrl = process.env.CDP_URL || "http://127.0.0.1:9222";

if (!apiKey) {
  console.error("AUTHLOOP_API_KEY is required");
  process.exit(1);
}

const client = new Authloop({ apiKey, baseUrl });

// Graceful shutdown
let stream = null;
async function cleanup(result) {
  console.log("\nCleaning up...");
  await stream?.stop();
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
const session = await client.handoff({
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

// 2. Poll until ACTIVE
console.log("Polling for viewer to connect...");
let status = await client.getSession(session.sessionId);
while (status.status === "PENDING") {
  process.stdout.write(".");
  await new Promise((r) => setTimeout(r, 3000));
  status = await client.getSession(session.sessionId);
}
console.log("");

if (status.status !== "ACTIVE") {
  console.log("Session terminated during polling:", status.status);
  process.exit(1);
}

console.log("Viewer connected! Starting stream...");

// 3. Start stream
stream = new BrowserStream({
  streamUrl: session.streamUrl,
  streamToken: session.streamToken,
  cdpUrl,
});

await stream.start();
console.log("Stream started — browser is now live in the viewer.");
console.log("Interact with the browser, then click Done or Cancel.\n");

// 4. Wait for resolution
const result = await stream.waitForResolution();
console.log("Stream result:", result);

// 5. Tell the API
if (result === "resolved") {
  console.log("Resolving session...");
  await client.resolveSession(session.sessionId).catch(() => {});
} else if (result === "cancelled") {
  console.log("Cancelling session...");
  await client.cancelSession(session.sessionId).catch(() => {});
}

await cleanup(result);
