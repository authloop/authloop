import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'AuthLoop',
    version: '0.2.2',
    description:
      'Human-in-the-loop authentication for AI agents. Resolve OTP, captcha, and password challenges from your browser.',
    permissions: [
      'tabs',         // query tab URLs to find auth pages
      'tabCapture',   // chrome.tabCapture.getMediaStreamId to capture tab video
      'storage',      // chrome.storage.local (tokens) + chrome.storage.session (active session)
      'alarms',       // token refresh, reconnect, keepalive, session timeout
      'notifications', // consent prompts for incoming sessions
      'offscreen',    // offscreen document for LiveKit WebRTC (needs DOM context)
      'debugger',     // chrome.debugger for dispatching input events to the tab
      'scripting',    // chrome.scripting.executeScript to read devicePixelRatio
    ],
    // Needed for chrome.debugger.attach (any tab) and chrome.scripting.executeScript (any origin)
    host_permissions: ['<all_urls>'],
    icons: {
      '16': 'icon-16.png',
      '48': 'icon-48.png',
      '128': 'icon-128.png',
    },
  },
});
