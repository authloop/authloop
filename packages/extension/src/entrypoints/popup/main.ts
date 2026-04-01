const DEFAULT_API_BASE = 'https://api.authloop.ai';

const pairingView = document.getElementById('pairing-view')!;
const connectedView = document.getElementById('connected-view')!;
const codeInput = document.getElementById('code-input') as HTMLInputElement;
const pairBtn = document.getElementById('pair-btn') as HTMLButtonElement;
const pairError = document.getElementById('pair-error')!;
const statusDot = document.getElementById('status-dot')!;
const statusText = document.getElementById('status-text')!;
const sessionShareView = document.getElementById('session-share-view')!;
const sessionShareService = document.getElementById('session-share-service')!;
const sessionShareHint = document.getElementById('session-share-hint')!;
const shareBtn = document.getElementById('share-btn') as HTMLButtonElement;
const sessionView = document.getElementById('session-view')!;
const idleView = document.getElementById('idle-view')!;
const sessionService = document.getElementById('session-service')!;
const sessionHint = document.getElementById('session-hint')!;
const resolveBtn = document.getElementById('resolve-btn')!;
const unpairBtn = document.getElementById('unpair-btn')!;

interface ActiveSession {
  sessionId: string;
  service: string;
  context?: { url?: string; blocker_type?: string; hint?: string };
  expiresAt: string;
}

interface ExtensionState {
  paired: boolean;
  connected: boolean;
  userId?: string;
  activeSession?: ActiveSession | null;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

async function init() {
  const state = await getState();
  if (state.paired) {
    showConnectedView(state);
    startPolling();
  } else {
    showPairingView();
  }
}

function startPolling() {
  stopPolling();
  // Poll every 2 seconds while popup is open to reflect session changes
  pollTimer = setInterval(async () => {
    const state = await getState();
    if (state.paired) {
      showConnectedView(state);
    } else {
      showPairingView();
      stopPolling();
    }
  }, 2000);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function getState(): Promise<ExtensionState> {
  return chrome.runtime.sendMessage({ type: 'GET_STATE' });
}

async function getApiBase(): Promise<string> {
  const { apiBaseUrl } = await chrome.storage.local.get('apiBaseUrl');
  return apiBaseUrl || DEFAULT_API_BASE;
}

function showPairingView() {
  pairingView.classList.remove('hidden');
  connectedView.classList.add('hidden');
  codeInput.focus();
}

function showConnectedView(state: ExtensionState) {
  pairingView.classList.add('hidden');
  connectedView.classList.remove('hidden');

  statusDot.className = `dot ${state.connected ? 'connected' : 'disconnected'}`;
  statusText.textContent = state.connected ? 'Connected' : 'Reconnecting...';

  if (state.activeSession) {
    idleView.classList.add('hidden');
    if (state.activeSession.capturing) {
      // Already sharing — show resolve button
      sessionShareView.classList.add('hidden');
      sessionView.classList.remove('hidden');
      sessionService.textContent = state.activeSession.service;
      sessionHint.textContent = state.activeSession.context?.hint ?? '';
    } else {
      // Needs user to click Share
      sessionView.classList.add('hidden');
      sessionShareView.classList.remove('hidden');
      sessionShareService.textContent = state.activeSession.service;
      sessionShareHint.textContent = state.activeSession.context?.hint ?? '';
    }
  } else {
    sessionShareView.classList.add('hidden');
    sessionView.classList.add('hidden');
    idleView.classList.remove('hidden');
  }
}

// --- Pairing ---

const PAIRING_CODE_PATTERN = /^[A-F0-9]{6}$/;

pairBtn.addEventListener('click', async () => {
  const code = codeInput.value.trim().toUpperCase();
  if (!PAIRING_CODE_PATTERN.test(code)) {
    pairError.textContent = 'Enter a 6-character code (letters A-F and digits 0-9).';
    pairError.classList.remove('hidden');
    return;
  }

  pairBtn.disabled = true;
  pairError.classList.add('hidden');

  try {
    const apiBase = await getApiBase();
    const res = await fetch(`${apiBase}/extension/confirm-pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });

    const data = (await res.json()) as Record<string, string>;

    if (!res.ok) {
      pairError.textContent =
        data.error === 'invalid_or_expired_code'
          ? 'Code is invalid or expired. Generate a new one from the dashboard.'
          : (data.error ?? 'Pairing failed.');
      pairError.classList.remove('hidden');
      return;
    }

    // Store tokens
    await chrome.storage.local.set({
      deviceId: data.device_id,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      userId: data.user_id,
    });

    // Tell background to connect
    chrome.runtime.sendMessage({ type: 'RECONNECT' });

    // Refresh UI
    const state = await getState();
    showConnectedView(state);
    startPolling();
  } catch {
    pairError.textContent = 'Network error. Check your connection.';
    pairError.classList.remove('hidden');
  } finally {
    pairBtn.disabled = false;
  }
});

// --- Share tab ---

shareBtn.addEventListener('click', async () => {
  shareBtn.disabled = true;
  shareBtn.textContent = 'Starting...';

  try {
    const state = await getState();
    if (!state.activeSession?.tabId) {
      shareBtn.textContent = 'No tab to share';
      return;
    }

    // Get tabCapture stream ID — works from popup because user clicked the button (user gesture)
    const streamId: string = await new Promise((resolve, reject) => {
      (chrome.tabCapture as any).getMediaStreamId(
        { targetTabId: state.activeSession!.tabId },
        (id: string) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(id);
          }
        },
      );
    });

    // Send stream ID to background to start LiveKit capture
    const result: { ok: boolean; error?: string } = await chrome.runtime.sendMessage({
      type: 'START_CAPTURE',
      streamId,
    });

    if (!result.ok) {
      shareBtn.textContent = result.error ?? 'Failed';
      shareBtn.disabled = false;
      return;
    }

    // Refresh UI to show "sharing active" state
    const newState = await getState();
    showConnectedView(newState);
  } catch (e: any) {
    console.error('[authloop:popup] share failed:', e);
    shareBtn.textContent = 'Failed — try again';
    shareBtn.disabled = false;
  }
});

// --- Resolve ---

resolveBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'RESOLVE_SESSION' });
  // Immediately update UI (background will handle the rest)
  sessionView.classList.add('hidden');
  idleView.classList.remove('hidden');
});

// --- Unpair ---

unpairBtn.addEventListener('click', async () => {
  // Revoke device server-side so refresh token is invalidated
  const { deviceId, userId } = await chrome.storage.local.get(['deviceId', 'userId']);
  if (deviceId && userId) {
    const apiBase = await getApiBase();
    // Best-effort revoke — don't block on failure
    fetch(`${apiBase}/extension/device/${deviceId}/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    }).catch(() => {});
  }

  await chrome.storage.local.remove(['accessToken', 'refreshToken', 'deviceId', 'userId']);
  chrome.runtime.sendMessage({ type: 'RECONNECT' });
  stopPolling();
  showPairingView();
});

// --- Input formatting ---

codeInput.addEventListener('input', () => {
  // Only allow hex characters
  codeInput.value = codeInput.value.toUpperCase().replace(/[^A-F0-9]/g, '');
});

// Enter key submits
codeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') pairBtn.click();
});

// Clean up on popup close
window.addEventListener('unload', stopPolling);

init();
