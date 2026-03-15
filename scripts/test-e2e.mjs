/**
 * E2E test: MCP stream.ts against local WebSocket relay + real CDP browser.
 * Tests the full frame/input pipeline without needing the AuthLoop API.
 *
 * Prerequisites:
 *   1. Chrome with CDP: google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/authloop-test
 *   2. Local relay:     node scripts/test-relay.mjs
 *   3. Run this:        node scripts/test-e2e.mjs
 *   4. Open viewer:     http://localhost:8888
 *
 * You should see the browser tab streaming in the viewer.
 * Click/type on the viewer canvas to interact with the remote browser.
 * Click "Resolve" to end the session.
 */

// We import the compiled stream module directly
const { BrowserStream } = await import("../packages/mcp/dist/stream.js");

const CDP_URL = process.env.CDP_URL || "http://127.0.0.1:9222";
const RELAY_URL = process.env.RELAY_URL || "ws://localhost:8888/stream/test";
const TOKEN = "test-token";

console.log("=== AuthLoop E2E Test ===");
console.log("CDP:   ", CDP_URL);
console.log("Relay: ", RELAY_URL);
console.log("");

const stream = new BrowserStream({
  streamUrl: RELAY_URL,
  streamToken: TOKEN,
  cdpUrl: CDP_URL,
});

// Graceful shutdown
async function cleanup(result) {
  console.log("\nStopping stream...");
  await stream.stop();
  console.log("Done. Result:", result ?? "interrupted");
  process.exit(0);
}
process.on("SIGINT", () => cleanup());
process.on("SIGTERM", () => cleanup());

try {
  console.log("Starting stream...");
  await stream.start();
  console.log("Stream started! Open http://localhost:8888 in your browser.");
  console.log("Click 'Resolve' in the viewer when done.\n");

  const result = await stream.waitForResolution();
  await cleanup(result);
} catch (err) {
  console.error("Error:", err.message);
  await stream.stop();
  process.exit(1);
}
