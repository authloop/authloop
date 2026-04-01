// Service worker: manages WSS connection, session lifecycle, LiveKit capture, input dispatch
//
// MV3 constraints:
// - All chrome.* listeners registered at top level
// - chrome.alarms for all timers
// - activeSession persisted in chrome.storage.session
// - Keepalive alarm during active sessions
// - Offscreen document for LiveKit (needs DOM context)
// - chrome.debugger for input dispatch (lazy attach/detach)

import type { BackendToExtensionMessage } from '@authloop-ai/core';

const DEFAULT_API_BASE = 'https://api.authloop.ai';

interface ActiveSession {
  sessionId: string;
  service: string;
  context?: { url?: string; blocker_type?: string; hint?: string };
  expiresAt: string;
  tabId?: number;
  livekitRoom?: string;
  livekitUrl?: string;
  livekitToken?: string;
  capturing?: boolean;
}

let ws: WebSocket | null = null;
let reconnectAttempts = 0;
let offscreenPort: chrome.runtime.Port | null = null;
let offscreenCreating: Promise<void> | null = null;

// Debugger state
const dbg = { attached: false, tabId: 0, detachTimer: 0 as ReturnType<typeof setTimeout> };

// ─── All chrome.* listeners at top level (MV3 requirement) ─────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('token-refresh', { periodInMinutes: 50 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  switch (alarm.name) {
    case 'token-refresh': await refreshAccessToken(); break;
    case 'reconnect': await connect(); break;
    case 'keepalive':
      if (ws?.readyState !== WebSocket.OPEN) await connect();
      break;
    case 'session-timeout': {
      const session = await getPersistedSession();
      if (session) {
        await clearSession();
        ws?.send(JSON.stringify({ type: 'session_error', session_id: session.sessionId, error: 'timeout' }));
      }
      break;
    }
  }
});

chrome.runtime.onStartup.addListener(() => { connect(); });

// Messages from popup
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'GET_STATE') { getState().then(sendResponse); return true; }
  if (msg.type === 'RECONNECT') { connect(); }
  if (msg.type === 'RESOLVE_SESSION') { resolveActiveSession(); }
  if (msg.type === 'START_CAPTURE') {
    // Triggered by user gesture from popup — tabCapture requires this
    handleStartCapture(msg.streamId).then(sendResponse);
    return true;
  }
});

// Notification click
chrome.notifications.onClicked.addListener(async (notifId) => {
  if (notifId.startsWith('session-')) {
    if (chrome.action.openPopup) chrome.action.openPopup().catch(() => {});
  }
});

// Port from offscreen document + debugger detach — registered in defineBackground
// because WXT's fake browser (used at build time) doesn't mock onConnect/onDetach.

// ─── WSS Connection ─────────────────────────────────────────────────────

async function getApiBase(): Promise<string> {
  const { apiBaseUrl } = await chrome.storage.local.get('apiBaseUrl');
  return apiBaseUrl || DEFAULT_API_BASE;
}

async function connect() {
  const { accessToken } = await chrome.storage.local.get(['accessToken']);
  if (!accessToken) return;

  if (ws) { ws.onclose = null; ws.close(); ws = null; }

  const apiBase = await getApiBase();
  const wsUrl = apiBase.replace(/^http/, 'ws') + `/extension/ws?token=${encodeURIComponent(accessToken)}`;

  try { ws = new WebSocket(wsUrl); } catch { scheduleReconnect(); return; }

  ws.onopen = () => {
    console.log('[authloop] WSS connected');
    reconnectAttempts = 0;
    chrome.alarms.clear('reconnect');
  };

  ws.onmessage = ({ data }) => {
    try {
      const msg = JSON.parse(data as string);
      if (msg.type === 'device_revoked') { handleDeviceRevoked(); return; }
      handleBackendMessage(msg as BackendToExtensionMessage);
    } catch (e) { console.error('[authloop] parse error:', e); }
  };

  ws.onclose = (event) => {
    ws = null;
    if (event.code === 4001) { handleDeviceRevoked(); return; }
    scheduleReconnect();
  };

  ws.onerror = () => {};
}

function scheduleReconnect() {
  reconnectAttempts++;
  const delaySec = Math.min(Math.pow(2, reconnectAttempts - 1), 30);
  chrome.alarms.create('reconnect', { when: Date.now() + delaySec * 1000 });
}

// ─── Device revocation ──────────────────────────────────────────────────

async function handleDeviceRevoked() {
  await chrome.storage.local.remove(['accessToken', 'refreshToken', 'deviceId', 'userId']);
  await clearSession();
  chrome.alarms.clear('reconnect');
  chrome.alarms.clear('token-refresh');
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
}

// ─── Session persistence ────────────────────────────────────────────────

async function getPersistedSession(): Promise<ActiveSession | null> {
  const { activeSession } = await chrome.storage.session.get('activeSession');
  return activeSession || null;
}

async function persistSession(session: ActiveSession | null) {
  if (session) await chrome.storage.session.set({ activeSession: session });
  else await chrome.storage.session.remove('activeSession');
}

// ─── Session handling ───────────────────────────────────────────────────

async function handleBackendMessage(msg: BackendToExtensionMessage) {
  if (msg.type === 'start_session') {
    console.log('[authloop] start_session:', msg.session_id, msg.service);

    const session: ActiveSession = {
      sessionId: msg.session_id,
      service: msg.service,
      context: msg.context,
      expiresAt: msg.expires_at,
      livekitRoom: msg.livekit_room,
    };

    await persistSession(session);

    // Keepalive + timeout alarms
    chrome.alarms.create('keepalive', { periodInMinutes: 25 / 60 });
    const ttlMs = new Date(msg.expires_at).getTime() - Date.now();
    if (ttlMs > 0) chrome.alarms.create('session-timeout', { when: Date.now() + ttlMs });

    // Notification
    chrome.notifications.create(`session-${msg.session_id}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon-128.png'),
      title: 'AuthLoop — Auth Required',
      message: `${msg.service} needs authentication${msg.context?.hint ? ': ' + msg.context.hint : ''}. Click to resolve.`,
      priority: 2,
      requireInteraction: true,
    });

    // Badge
    chrome.action.setBadgeText({ text: '\u25CF' });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });

    // Find/open target tab
    console.log('[authloop] finding tab for:', msg.context?.url ?? 'no URL hint');
    const tabId = await findOrOpenTab(msg.context?.url);
    console.log('[authloop] tab found/opened:', tabId);

    if (tabId) {
      session.tabId = tabId;
      // Store LiveKit credentials for when user triggers capture from popup
      if (msg.livekit_url && msg.livekit_token) {
        (session as any).livekitUrl = msg.livekit_url;
        (session as any).livekitToken = msg.livekit_token;
      }
      await persistSession(session);
      console.log('[authloop] session ready, waiting for user to start capture from popup');
    } else {
      console.warn('[authloop] no tab found for session');
    }

    // Acknowledge
    ws?.send(JSON.stringify({ type: 'session_ack', session_id: msg.session_id }));
  }

  if (msg.type === 'stop_session') {
    const session = await getPersistedSession();
    if (session?.sessionId === msg.session_id) await clearSession();
  }
}

async function resolveActiveSession() {
  const session = await getPersistedSession();
  if (!session) return;
  ws?.send(JSON.stringify({ type: 'auth_complete', session_id: session.sessionId }));
  await clearSession();
}

async function clearSession() {
  const session = await getPersistedSession();
  if (session) {
    chrome.notifications.clear(`session-${session.sessionId}`);
    offscreenPort?.postMessage({ type: 'STOP_LIVEKIT' });
    // Detach debugger
    if (dbg.attached && session.tabId) {
      try { await chrome.debugger.detach({ tabId: session.tabId }); } catch {}
      Object.assign(dbg, { attached: false, tabId: 0 });
    }
    clearTimeout(dbg.detachTimer);
  }
  await persistSession(null);
  chrome.action.setBadgeText({ text: '' });
  chrome.alarms.clear('keepalive');
  chrome.alarms.clear('session-timeout');
}

async function handleTrackEnded(sessionId: string) {
  const session = await getPersistedSession();
  if (session?.sessionId === sessionId) {
    ws?.send(JSON.stringify({ type: 'session_error', session_id: sessionId, error: 'tab_closed' }));
    await clearSession();
  }
}

// ─── Capture trigger (from popup user gesture) ──────────────────────────

async function handleStartCapture(streamId: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getPersistedSession();
  if (!session) return { ok: false, error: 'no active session' };
  if (!session.tabId) return { ok: false, error: 'no tab ID' };
  if (!session.livekitUrl || !session.livekitToken) return { ok: false, error: 'no LiveKit credentials' };
  if (session.capturing) return { ok: true }; // already capturing

  console.log('[authloop] starting capture from popup gesture, tab:', session.tabId);
  try {
    await startLiveKitCapture(session.tabId, streamId, {
      sessionId: session.sessionId,
      livekitUrl: session.livekitUrl,
      livekitToken: session.livekitToken,
    });
    session.capturing = true;
    await persistSession(session);
    return { ok: true };
  } catch (e: any) {
    console.error('[authloop] capture failed:', e);
    return { ok: false, error: e.message };
  }
}

// ─── Tab management ─────────────────────────────────────────────────────

async function findOrOpenTab(urlHint?: string): Promise<number | null> {
  if (urlHint) {
    try {
      const hostname = new URL(urlHint).hostname;
      console.log('[authloop] searching tabs for hostname:', hostname);
      const tabs = await chrome.tabs.query({ url: `*://${hostname}/*` });
      console.log('[authloop] matching tabs found:', tabs.length);
      if (tabs[0]?.id) {
        console.log('[authloop] focusing existing tab:', tabs[0].id, tabs[0].url);
        chrome.tabs.update(tabs[0].id, { active: true });
        if (tabs[0].windowId) chrome.windows.update(tabs[0].windowId, { focused: true });
        await waitForTabLoaded(tabs[0].id);
        return tabs[0].id;
      }
      console.log('[authloop] no matching tab, opening new tab:', urlHint);
      const newTab = await chrome.tabs.create({ url: urlHint, active: true });
      console.log('[authloop] new tab created:', newTab.id, 'status:', newTab.status);
      if (newTab.id) {
        await waitForTabLoaded(newTab.id);
        console.log('[authloop] new tab loaded');
        return newTab.id;
      }
      return null;
    } catch (e) {
      console.error('[authloop] findOrOpenTab error:', e);
    }
  }
  console.log('[authloop] no URL hint, using active tab');
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  console.log('[authloop] active tab:', activeTab?.id, activeTab?.url);
  return activeTab?.id ?? null;
}

function waitForTabLoaded(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    // Check if already loaded
    chrome.tabs.get(tabId, (tab) => {
      if (tab.status === 'complete') { resolve(); return; }

      // Wait for the tab to finish loading
      const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);

      // Safety timeout — don't wait forever
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 15000);
    });
  });
}

// ─── LiveKit capture ────────────────────────────────────────────────────

async function ensureOffscreen(): Promise<void> {
  if (offscreenPort) return;
  if (offscreenCreating) return offscreenCreating;

  offscreenCreating = (async () => {
    const contexts = await (chrome.runtime as any).getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
    });
    if (contexts.length === 0) {
      await (chrome.offscreen as any).createDocument({
        url: chrome.runtime.getURL('offscreen.html'),
        reasons: ['USER_MEDIA'],
        justification: 'LiveKit WebRTC via tabCapture for auth session streaming',
      });
    }
    // Wait for port
    await new Promise<void>(resolve => {
      const check = setInterval(() => {
        if (offscreenPort) { clearInterval(check); resolve(); }
      }, 50);
    });
  })();

  await offscreenCreating;
  offscreenCreating = null;
}

async function startLiveKitCapture(
  tabId: number,
  streamId: string,
  opts: { sessionId: string; livekitUrl: string; livekitToken: string },
) {
  // Get tab dimensions + DPR
  const tab = await chrome.tabs.get(tabId);
  console.log('[authloop] tab info — url:', tab.url, 'status:', tab.status, 'size:', tab.width, 'x', tab.height);

  let dpr = 1;
  try {
    const [{ result }] = await (chrome.scripting as any).executeScript({
      target: { tabId },
      func: () => window.devicePixelRatio ?? 1,
    });
    dpr = result as number;
    console.log('[authloop] DPR:', dpr);
  } catch (e) {
    console.warn('[authloop] failed to get DPR:', e);
  }

  console.log('[authloop] stream ID from popup:', streamId.slice(0, 20) + '...');

  // Ensure offscreen document
  console.log('[authloop] ensuring offscreen document...');
  await ensureOffscreen();
  console.log('[authloop] offscreen document ready, sending START_LIVEKIT');

  // Tell offscreen to start LiveKit
  offscreenPort?.postMessage({
    type: 'START_LIVEKIT',
    streamId,
    sessionId: opts.sessionId,
    livekitUrl: opts.livekitUrl,
    livekitToken: opts.livekitToken,
    cssWidth: tab.width ?? 1280,
    cssHeight: tab.height ?? 720,
    pixelRatio: dpr,
  });
}

// ─── Input dispatch via chrome.debugger ─────────────────────────────────

async function ensureDebugger(tabId: number) {
  if (dbg.attached && dbg.tabId === tabId) return;
  if (dbg.attached) {
    try { await chrome.debugger.detach({ tabId: dbg.tabId }); } catch {}
  }
  await chrome.debugger.attach({ tabId }, '1.3');
  Object.assign(dbg, { attached: true, tabId });
}

function scheduleDetach(tabId: number, ms = 3000) {
  clearTimeout(dbg.detachTimer);
  dbg.detachTimer = setTimeout(async () => {
    if (!dbg.attached || dbg.tabId !== tabId) return;
    try { await chrome.debugger.detach({ tabId }); } catch {}
    Object.assign(dbg, { attached: false, tabId: 0 });
  }, ms);
}

async function handleInputEvent(msg: any) {
  const session = await getPersistedSession();
  if (!session?.tabId) return;
  const tabId = session.tabId;

  try {
    switch (msg.type) {
      case 'click': {
        if (!Number.isFinite(msg.x) || !Number.isFinite(msg.y)) return;
        await ensureDebugger(tabId);
        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent',
          { type: 'mousePressed', x: msg.x, y: msg.y, button: 'left', clickCount: 1, modifiers: 0 });
        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent',
          { type: 'mouseReleased', x: msg.x, y: msg.y, button: 'left', clickCount: 1, modifiers: 0 });
        scheduleDetach(tabId);
        break;
      }
      case 'keydown': {
        await ensureDebugger(tabId);
        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
          type: 'rawKeyDown', key: msg.key, code: msg.code,
          text: msg.key?.length === 1 ? msg.key : undefined,
          modifiers: msg.modifiers ?? 0,
          windowsVirtualKeyCode: msg.keyCode ?? 0,
        });
        scheduleDetach(tabId);
        break;
      }
      case 'keyup': {
        await ensureDebugger(tabId);
        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
          type: 'keyUp', key: msg.key, code: msg.code,
          modifiers: msg.modifiers ?? 0,
          windowsVirtualKeyCode: msg.keyCode ?? 0,
        });
        scheduleDetach(tabId);
        break;
      }
      case 'keypress': {
        if (!msg.key || msg.key.length !== 1) return;
        await ensureDebugger(tabId);
        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
          type: 'char', text: msg.key, modifiers: msg.modifiers ?? 0,
        });
        scheduleDetach(tabId);
        break;
      }
      case 'scroll': {
        if (!Number.isFinite(msg.x) || !Number.isFinite(msg.y)) return;
        await ensureDebugger(tabId);
        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
          type: 'mouseWheel', x: msg.x, y: msg.y,
          deltaX: msg.deltaX ?? 0, deltaY: msg.deltaY ?? 0,
        });
        scheduleDetach(tabId);
        break;
      }
      case 'paste': {
        if (typeof msg.text !== 'string' || msg.text.length > 10_000) return;
        await ensureDebugger(tabId);
        await chrome.debugger.sendCommand({ tabId }, 'Input.insertText', { text: msg.text });
        scheduleDetach(tabId);
        break;
      }
      case 'resolved': {
        await resolveActiveSession();
        break;
      }
      case 'cancelled': {
        ws?.send(JSON.stringify({ type: 'session_error', session_id: session.sessionId, error: 'cancelled' }));
        await clearSession();
        break;
      }
    }
  } catch (e) {
    console.error('[authloop] input dispatch error:', e);
  }
}

// ─── Token management ───────────────────────────────────────────────────

async function refreshAccessToken() {
  const { refreshToken, deviceId } = await chrome.storage.local.get(['refreshToken', 'deviceId']);
  if (!refreshToken || !deviceId) return;
  const apiBase = await getApiBase();

  try {
    const res = await fetch(`${apiBase}/extension/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken, device_id: deviceId }),
    });

    if (!res.ok) {
      if (res.status === 401) {
        await chrome.storage.local.remove(['accessToken', 'refreshToken', 'deviceId', 'userId']);
        ws?.close();
      }
      return;
    }

    const data = (await res.json()) as { access_token: string };
    await chrome.storage.local.set({ accessToken: data.access_token });
    connect();
  } catch {}
}

// ─── State ──────────────────────────────────────────────────────────────

async function getState() {
  const { accessToken, deviceId, userId } = await chrome.storage.local.get(['accessToken', 'deviceId', 'userId']);
  const session = await getPersistedSession();
  return {
    paired: !!(accessToken && deviceId),
    connected: ws?.readyState === WebSocket.OPEN,
    userId,
    activeSession: session,
  };
}

// ─── Init ───────────────────────────────────────────────────────────────

export default defineBackground(async () => {
  // Register listeners that WXT's fake-browser doesn't mock (onConnect, debugger.onDetach).
  // These still run at SW startup, which is early enough for MV3.

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'authloop-offscreen') return;
    offscreenPort = port;

    port.onMessage.addListener((msg) => {
      if (msg.type === 'HEARTBEAT') return;
      if (msg.type === 'TRACK_ENDED') handleTrackEnded(msg.sessionId);
      if (msg.type === 'LIVEKIT_CONNECTED') console.log('[authloop] LiveKit streaming for', msg.sessionId);
      if (msg.type === 'LIVEKIT_ERROR') console.error('[authloop] LiveKit error:', msg.error);
      // Input events forwarded from offscreen (originally from LiveKit data channel)
      if (['click', 'dblclick', 'keydown', 'keyup', 'keypress', 'scroll', 'paste', 'resolved', 'cancelled'].includes(msg.type)) {
        handleInputEvent(msg);
      }
    });

    port.onDisconnect.addListener(() => {
      offscreenPort = null;
      offscreenCreating = null;
    });
  });

  chrome.debugger.onDetach.addListener((source, reason) => {
    if (source.tabId === dbg.tabId) {
      console.warn('[authloop] debugger detached:', reason);
      clearTimeout(dbg.detachTimer);
      Object.assign(dbg, { attached: false, tabId: 0 });
    }
  });

  // Restore session state
  const session = await getPersistedSession();
  if (session) {
    chrome.action.setBadgeText({ text: '\u25CF' });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
    chrome.alarms.create('keepalive', { periodInMinutes: 25 / 60 });
  }
  connect();
});
