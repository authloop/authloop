/**
 * Local WebSocket relay for E2E testing.
 * Simulates the Cloudflare Durable Object that will relay frames/events
 * between the MCP agent and the human's browser.
 *
 * Usage: node scripts/test-relay.mjs
 * Then open http://localhost:8888 in a browser to see the viewer.
 */

import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "node:http";

const PORT = 8888;

const http = createServer((req, res) => {
  if (req.url === "/" || req.url?.startsWith("/?")) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(VIEWER_HTML);
    return;
  }
  res.writeHead(404);
  res.end("Not found");
});

const wss = new WebSocketServer({ server: http });

let agent = null;
let viewer = null;
let agentPubKey = null; // cached for late-joining viewers

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const role = url.searchParams.get("role");
  const path = url.pathname;

  console.log(`[RELAY] ${role} connected (${path})`);

  if (role === "agent") {
    agent = ws;
    if (viewer?.readyState === WebSocket.OPEN) {
      viewer.send(JSON.stringify({ type: "agent_connected" }));
      ws.send(JSON.stringify({ type: "viewer_connected" }));
    }
  } else {
    viewer = ws;
    if (agent?.readyState === WebSocket.OPEN) {
      agent.send(JSON.stringify({ type: "viewer_connected" }));
      ws.send(JSON.stringify({ type: "agent_connected" }));
    }
    // Send cached agent pubkey so viewer can complete E2EE key exchange
    if (agentPubKey) {
      console.log("[RELAY] sending cached agent pubkey to viewer");
      ws.send(agentPubKey);
    }
  }

  ws.on("message", (data, isBinary) => {
    // Cache agent's pubkey for late-joining viewers
    if (!isBinary && ws === agent) {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "pubkey") {
          agentPubKey = data.toString();
          console.log("[RELAY] cached agent pubkey");
        }
      } catch {}
    }

    const target = ws === agent ? viewer : agent;
    if (target?.readyState === WebSocket.OPEN) {
      target.send(data, { binary: isBinary });
    }
    if (!isBinary && ws !== agent) {
      console.log(`[RELAY] viewer → agent: ${data.toString().slice(0, 100)}`);
    }
  });

  ws.on("close", () => {
    console.log(`[RELAY] ${role} disconnected`);
    if (ws === agent) {
      agent = null;
      if (viewer?.readyState === WebSocket.OPEN) {
        viewer.send(JSON.stringify({ type: "agent_disconnected" }));
      }
    } else {
      viewer = null;
      if (agent?.readyState === WebSocket.OPEN) {
        agent.send(JSON.stringify({ type: "viewer_disconnected" }));
      }
    }
  });
});

http.listen(PORT, () => {
  console.log(`[RELAY] WebSocket relay on ws://localhost:${PORT}/stream/test`);
  console.log(`[RELAY] Viewer UI on http://localhost:${PORT}`);
  console.log(`[RELAY] Waiting for agent and viewer connections...`);
});

// Minimal viewer HTML — renders JPEG frames, captures input events
const VIEWER_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>AuthLoop Test Viewer</title>
  <style>
    body { margin: 0; background: #111; display: flex; flex-direction: column; align-items: center; font-family: system-ui; color: #eee; }
    h3 { margin: 12px 0 8px; }
    #status { color: #888; margin-bottom: 8px; font-size: 14px; }
    #screen { border: 2px solid #333; cursor: crosshair; background: #000; }
    #controls { margin-top: 12px; }
    button { padding: 8px 20px; font-size: 16px; cursor: pointer; margin: 0 4px; }
    #resolve-btn { background: #22c55e; color: white; border: none; border-radius: 4px; }
    #log { margin-top: 12px; font-size: 12px; color: #666; max-height: 150px; overflow-y: auto; width: 1280px; }
  </style>
</head>
<body>
  <h3>AuthLoop — Remote Browser</h3>
  <div id="status">Connecting...</div>
  <canvas id="screen" width="1280" height="720" tabindex="0"></canvas>
  <div id="controls">
    <button id="back-btn">&#9664; Back</button>
    <button id="forward-btn">Forward &#9654;</button>
    <button id="reload-btn">&#8635; Reload</button>
    <button id="resolve-btn">Done (auth complete)</button>
    <button id="cancel-btn" style="background:#ef4444;color:white;border:none;border-radius:4px;">Cancel</button>
  </div>
  <div id="log"></div>
  <script>
    const canvas = document.getElementById('screen');
    const ctx = canvas.getContext('2d');
    const status = document.getElementById('status');
    const log = document.getElementById('log');
    let frameCount = 0;

    function addLog(msg) {
      const div = document.createElement('div');
      div.textContent = new Date().toLocaleTimeString() + ' ' + msg;
      log.prepend(div);
      if (log.children.length > 50) log.lastChild.remove();
    }

    let frameMeta = null; // latest frame metadata for coordinate mapping
    let e2eeKey = null; // CryptoKey for AES-256-GCM
    let e2eeReady = false;
    let ecdh = null; // our ECDH key pair

    // E2EE: generate our keypair on load
    async function initE2EE() {
      ecdh = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
      addLog('E2EE: keypair generated');
    }
    initE2EE();

    async function handleAgentPubKey(agentKeyBase64) {
      // Import agent's public key
      const agentKeyRaw = Uint8Array.from(atob(agentKeyBase64), c => c.charCodeAt(0));
      const agentPubKey = await crypto.subtle.importKey('raw', agentKeyRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
      // Derive shared secret
      const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: agentPubKey }, ecdh.privateKey, 256);
      e2eeKey = await crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['encrypt', 'decrypt']);
      e2eeReady = true;
      addLog('E2EE: shared secret derived — input is now encrypted');
      // Send our public key back
      const ourPubKey = await crypto.subtle.exportKey('raw', ecdh.publicKey);
      const ourPubKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(ourPubKey)));
      ws.send(JSON.stringify({ type: 'pubkey', key: ourPubKeyBase64 }));
    }

    async function encryptAndSend(msg) {
      if (!e2eeReady) { addLog('E2EE not ready — input blocked'); return; }
      const plaintext = new TextEncoder().encode(JSON.stringify(msg));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, e2eeKey, plaintext);
      const ctBytes = new Uint8Array(ciphertext.slice(0, ciphertext.byteLength - 16));
      const tag = new Uint8Array(ciphertext.slice(ciphertext.byteLength - 16));
      ws.send(JSON.stringify({
        type: 'encrypted',
        payload: {
          iv: btoa(String.fromCharCode(...iv)),
          ciphertext: btoa(String.fromCharCode(...ctBytes)),
          tag: btoa(String.fromCharCode(...tag)),
        }
      }));
    }

    const ws = new WebSocket('ws://localhost:${PORT}/stream/test?role=viewer');
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => { status.textContent = 'Connected — waiting for agent...'; addLog('Connected to relay'); };
    ws.onclose = () => { endSession('Disconnected'); addLog('Disconnected'); };

    ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        // Binary = JPEG frame
        const blob = new Blob([e.data], { type: 'image/jpeg' });
        const img = new Image();
        img.onload = () => {
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(img.src);
          frameCount++;
          if (frameCount % 30 === 0) addLog('Frames: ' + frameCount);
        };
        img.src = URL.createObjectURL(blob);
        if (frameCount === 0) status.textContent = 'Streaming — click and type on the browser below';
      } else {
        // JSON message
        const msg = JSON.parse(e.data);
        if (msg.type === 'frame') {
          // Frame metadata — store for coordinate mapping
          frameMeta = msg;
          if (frameCount < 3) addLog('Frame meta: device=' + msg.deviceWidth + 'x' + msg.deviceHeight + ' canvas=' + canvas.width + 'x' + canvas.height);
        } else if (msg.type === 'pubkey') {
          // E2EE key exchange — agent sent its public key
          handleAgentPubKey(msg.key);
        } else {
          addLog('Server: ' + msg.type);
          if (msg.type === 'agent_connected') status.textContent = 'Agent connected — streaming will start';
          if (msg.type === 'agent_disconnected') { endSession('Session ended'); ws.close(); }
          if (msg.type === 'session_expired') { endSession('Session expired'); ws.close(); }
          if (msg.type === 'session_cancelled') { endSession('Session cancelled'); ws.close(); }
        }
      }
    };

    function send(msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }

    // Map canvas pixel coordinates to CDP viewport coordinates
    function mapCoords(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      // Position relative to canvas element (0..rect.width, 0..rect.height)
      const canvasX = clientX - rect.left;
      const canvasY = clientY - rect.top;

      if (frameMeta && frameMeta.deviceWidth && frameMeta.deviceHeight) {
        // Map from displayed canvas size to actual device viewport
        const x = Math.round((canvasX / rect.width) * frameMeta.deviceWidth);
        const y = Math.round((canvasY / rect.height) * frameMeta.deviceHeight);
        return { x, y };
      }

      // Fallback: map from displayed size to canvas pixel size
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return { x: Math.round(canvasX * scaleX), y: Math.round(canvasY * scaleY) };
    }

    // Mouse events
    canvas.addEventListener('click', (e) => {
      const { x, y } = mapCoords(e.clientX, e.clientY);
      encryptAndSend({ type: 'click', x, y, button: 'left' });
      addLog('Click: ' + x + ', ' + y + (e2eeReady ? ' [encrypted]' : ' [blocked]'));
    });

    canvas.addEventListener('dblclick', (e) => {
      const { x, y } = mapCoords(e.clientX, e.clientY);
      encryptAndSend({ type: 'dblclick', x, y });
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const { x, y } = mapCoords(e.clientX, e.clientY);
      encryptAndSend({ type: 'scroll', x, y, deltaX: e.deltaX, deltaY: e.deltaY });
    }, { passive: false });

    // Keyboard events — canvas must be focused
    // Send all keys with modifier state for Ctrl+A, Ctrl+C, Ctrl+V etc.
    const modifierKeys = new Set(['Shift', 'Control', 'Alt', 'Meta']);

    canvas.addEventListener('keydown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const mods = { altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey };

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        // Printable character — encrypt (contains passwords/OTPs)
        encryptAndSend({ type: 'keypress', key: e.key, code: e.code, ...mods });
      } else {
        // Special key or modified key — encrypt (Ctrl+V paste, etc.)
        encryptAndSend({ type: 'keydown', key: e.key, code: e.code, ...mods });
      }
      if (!modifierKeys.has(e.key)) addLog('Key: ' + (e.ctrlKey ? 'Ctrl+' : '') + (e.metaKey ? 'Cmd+' : '') + (e.shiftKey ? 'Shift+' : '') + e.key + (e2eeReady ? ' [encrypted]' : ''));
    });

    canvas.addEventListener('keyup', (e) => {
      e.preventDefault();
      e.stopPropagation();
      encryptAndSend({ type: 'keyup', key: e.key, code: e.code, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey });
    });

    // Focus canvas on click
    canvas.addEventListener('mousedown', () => canvas.focus());

    // Resolve button
    document.getElementById('back-btn').addEventListener('click', () => {
      encryptAndSend({ type: 'back' });
      addLog('Navigate: back');
    });

    document.getElementById('forward-btn').addEventListener('click', () => {
      encryptAndSend({ type: 'forward' });
      addLog('Navigate: forward');
    });

    document.getElementById('reload-btn').addEventListener('click', () => {
      encryptAndSend({ type: 'reload' });
      addLog('Navigate: reload');
    });

    function endSession(label) {
      status.textContent = label;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#888';
      ctx.font = '24px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(label, canvas.width / 2, canvas.height / 2);
      document.getElementById('resolve-btn').disabled = true;
      document.getElementById('cancel-btn').disabled = true;
      document.getElementById('back-btn').disabled = true;
      document.getElementById('forward-btn').disabled = true;
      document.getElementById('reload-btn').disabled = true;
    }

    document.getElementById('resolve-btn').addEventListener('click', () => {
      encryptAndSend({ type: 'resolved' });
      endSession('Done — auth complete');
      addLog('Sent: resolved' + (e2eeReady ? ' [encrypted]' : ' [blocked]'));
    });

    document.getElementById('cancel-btn').addEventListener('click', () => {
      encryptAndSend({ type: 'cancelled' });
      endSession('Cancelled');
      addLog('Sent: cancelled' + (e2eeReady ? ' [encrypted]' : ' [blocked]'));
    });
  </script>
</body>
</html>`;
