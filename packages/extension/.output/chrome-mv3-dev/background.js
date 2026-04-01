var background = (function() {
	//#region ../../node_modules/.pnpm/wxt@0.20.20_@types+node@22.19.15_jiti@2.6.1_tsx@4.21.0/node_modules/wxt/dist/utils/define-background.mjs
	function defineBackground(arg) {
		if (arg == null || typeof arg === "function") return { main: arg };
		return arg;
	}
	//#endregion
	//#region src/entrypoints/background.ts
	var DEFAULT_API_BASE = "https://api.authloop.ai";
	var ws$1 = null;
	var reconnectAttempts = 0;
	var offscreenPort = null;
	var offscreenCreating = null;
	var dbg = {
		attached: false,
		tabId: 0,
		detachTimer: 0
	};
	chrome.runtime.onInstalled.addListener(() => {
		chrome.alarms.create("token-refresh", { periodInMinutes: 50 });
	});
	chrome.alarms.onAlarm.addListener(async (alarm) => {
		switch (alarm.name) {
			case "token-refresh":
				await refreshAccessToken();
				break;
			case "reconnect":
				await connect();
				break;
			case "keepalive":
				if (ws$1?.readyState !== WebSocket.OPEN) await connect();
				break;
			case "session-timeout": {
				const session = await getPersistedSession();
				if (session) {
					await clearSession();
					ws$1?.send(JSON.stringify({
						type: "session_error",
						session_id: session.sessionId,
						error: "timeout"
					}));
				}
				break;
			}
		}
	});
	chrome.runtime.onStartup.addListener(() => {
		connect();
	});
	chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
		if (msg.type === "GET_STATE") {
			getState().then(sendResponse);
			return true;
		}
		if (msg.type === "RECONNECT") connect();
		if (msg.type === "RESOLVE_SESSION") resolveActiveSession();
		if (msg.type === "START_CAPTURE") {
			handleStartCapture(msg.streamId).then(sendResponse);
			return true;
		}
	});
	chrome.notifications.onClicked.addListener(async (notifId) => {
		if (notifId.startsWith("session-")) {
			if (chrome.action.openPopup) chrome.action.openPopup().catch(() => {});
		}
	});
	async function getApiBase() {
		const { apiBaseUrl } = await chrome.storage.local.get("apiBaseUrl");
		return apiBaseUrl || DEFAULT_API_BASE;
	}
	async function connect() {
		const { accessToken } = await chrome.storage.local.get(["accessToken"]);
		if (!accessToken) return;
		if (ws$1) {
			ws$1.onclose = null;
			ws$1.close();
			ws$1 = null;
		}
		const wsUrl = (await getApiBase()).replace(/^http/, "ws") + `/extension/ws?token=${encodeURIComponent(accessToken)}`;
		try {
			ws$1 = new WebSocket(wsUrl);
		} catch {
			scheduleReconnect();
			return;
		}
		ws$1.onopen = () => {
			console.log("[authloop] WSS connected");
			reconnectAttempts = 0;
			chrome.alarms.clear("reconnect");
		};
		ws$1.onmessage = ({ data }) => {
			try {
				const msg = JSON.parse(data);
				if (msg.type === "device_revoked") {
					handleDeviceRevoked();
					return;
				}
				handleBackendMessage(msg);
			} catch (e) {
				console.error("[authloop] parse error:", e);
			}
		};
		ws$1.onclose = (event) => {
			ws$1 = null;
			if (event.code === 4001) {
				handleDeviceRevoked();
				return;
			}
			scheduleReconnect();
		};
		ws$1.onerror = () => {};
	}
	function scheduleReconnect() {
		reconnectAttempts++;
		const delaySec = Math.min(Math.pow(2, reconnectAttempts - 1), 30);
		chrome.alarms.create("reconnect", { when: Date.now() + delaySec * 1e3 });
	}
	async function handleDeviceRevoked() {
		await chrome.storage.local.remove([
			"accessToken",
			"refreshToken",
			"deviceId",
			"userId"
		]);
		await clearSession();
		chrome.alarms.clear("reconnect");
		chrome.alarms.clear("token-refresh");
		if (ws$1) {
			ws$1.onclose = null;
			ws$1.close();
			ws$1 = null;
		}
	}
	async function getPersistedSession() {
		const { activeSession } = await chrome.storage.session.get("activeSession");
		return activeSession || null;
	}
	async function persistSession(session) {
		if (session) await chrome.storage.session.set({ activeSession: session });
		else await chrome.storage.session.remove("activeSession");
	}
	async function handleBackendMessage(msg) {
		if (msg.type === "start_session") {
			console.log("[authloop] start_session:", msg.session_id, msg.service);
			const session = {
				sessionId: msg.session_id,
				service: msg.service,
				context: msg.context,
				expiresAt: msg.expires_at,
				livekitRoom: msg.livekit_room
			};
			await persistSession(session);
			chrome.alarms.create("keepalive", { periodInMinutes: 25 / 60 });
			const ttlMs = new Date(msg.expires_at).getTime() - Date.now();
			if (ttlMs > 0) chrome.alarms.create("session-timeout", { when: Date.now() + ttlMs });
			chrome.notifications.create(`session-${msg.session_id}`, {
				type: "basic",
				iconUrl: chrome.runtime.getURL("icon-128.png"),
				title: "AuthLoop — Auth Required",
				message: `${msg.service} needs authentication${msg.context?.hint ? ": " + msg.context.hint : ""}. Click to resolve.`,
				priority: 2,
				requireInteraction: true
			});
			chrome.action.setBadgeText({ text: "●" });
			chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
			console.log("[authloop] finding tab for:", msg.context?.url ?? "no URL hint");
			const tabId = await findOrOpenTab(msg.context?.url);
			console.log("[authloop] tab found/opened:", tabId);
			if (tabId) {
				session.tabId = tabId;
				if (msg.livekit_url && msg.livekit_token) {
					session.livekitUrl = msg.livekit_url;
					session.livekitToken = msg.livekit_token;
				}
				await persistSession(session);
				console.log("[authloop] session ready, waiting for user to start capture from popup");
			} else console.warn("[authloop] no tab found for session");
			ws$1?.send(JSON.stringify({
				type: "session_ack",
				session_id: msg.session_id
			}));
		}
		if (msg.type === "stop_session") {
			if ((await getPersistedSession())?.sessionId === msg.session_id) await clearSession();
		}
	}
	async function resolveActiveSession() {
		const session = await getPersistedSession();
		if (!session) return;
		ws$1?.send(JSON.stringify({
			type: "auth_complete",
			session_id: session.sessionId
		}));
		await clearSession();
	}
	async function clearSession() {
		const session = await getPersistedSession();
		if (session) {
			chrome.notifications.clear(`session-${session.sessionId}`);
			offscreenPort?.postMessage({ type: "STOP_LIVEKIT" });
			if (dbg.attached && session.tabId) {
				try {
					await chrome.debugger.detach({ tabId: session.tabId });
				} catch {}
				Object.assign(dbg, {
					attached: false,
					tabId: 0
				});
			}
			clearTimeout(dbg.detachTimer);
		}
		await persistSession(null);
		chrome.action.setBadgeText({ text: "" });
		chrome.alarms.clear("keepalive");
		chrome.alarms.clear("session-timeout");
	}
	async function handleTrackEnded(sessionId) {
		if ((await getPersistedSession())?.sessionId === sessionId) {
			ws$1?.send(JSON.stringify({
				type: "session_error",
				session_id: sessionId,
				error: "tab_closed"
			}));
			await clearSession();
		}
	}
	async function handleStartCapture(streamId) {
		const session = await getPersistedSession();
		if (!session) return {
			ok: false,
			error: "no active session"
		};
		if (!session.tabId) return {
			ok: false,
			error: "no tab ID"
		};
		if (!session.livekitUrl || !session.livekitToken) return {
			ok: false,
			error: "no LiveKit credentials"
		};
		if (session.capturing) return { ok: true };
		console.log("[authloop] starting capture from popup gesture, tab:", session.tabId);
		try {
			await startLiveKitCapture(session.tabId, streamId, {
				sessionId: session.sessionId,
				livekitUrl: session.livekitUrl,
				livekitToken: session.livekitToken
			});
			session.capturing = true;
			await persistSession(session);
			return { ok: true };
		} catch (e) {
			console.error("[authloop] capture failed:", e);
			return {
				ok: false,
				error: e.message
			};
		}
	}
	async function findOrOpenTab(urlHint) {
		if (urlHint) try {
			const hostname = new URL(urlHint).hostname;
			console.log("[authloop] searching tabs for hostname:", hostname);
			const tabs = await chrome.tabs.query({ url: `*://${hostname}/*` });
			console.log("[authloop] matching tabs found:", tabs.length);
			if (tabs[0]?.id) {
				console.log("[authloop] focusing existing tab:", tabs[0].id, tabs[0].url);
				chrome.tabs.update(tabs[0].id, { active: true });
				if (tabs[0].windowId) chrome.windows.update(tabs[0].windowId, { focused: true });
				await waitForTabLoaded(tabs[0].id);
				return tabs[0].id;
			}
			console.log("[authloop] no matching tab, opening new tab:", urlHint);
			const newTab = await chrome.tabs.create({
				url: urlHint,
				active: true
			});
			console.log("[authloop] new tab created:", newTab.id, "status:", newTab.status);
			if (newTab.id) {
				await waitForTabLoaded(newTab.id);
				console.log("[authloop] new tab loaded");
				return newTab.id;
			}
			return null;
		} catch (e) {
			console.error("[authloop] findOrOpenTab error:", e);
		}
		console.log("[authloop] no URL hint, using active tab");
		const [activeTab] = await chrome.tabs.query({
			active: true,
			currentWindow: true
		});
		console.log("[authloop] active tab:", activeTab?.id, activeTab?.url);
		return activeTab?.id ?? null;
	}
	function waitForTabLoaded(tabId) {
		return new Promise((resolve) => {
			chrome.tabs.get(tabId, (tab) => {
				if (tab.status === "complete") {
					resolve();
					return;
				}
				const listener = (updatedTabId, changeInfo) => {
					if (updatedTabId === tabId && changeInfo.status === "complete") {
						chrome.tabs.onUpdated.removeListener(listener);
						resolve();
					}
				};
				chrome.tabs.onUpdated.addListener(listener);
				setTimeout(() => {
					chrome.tabs.onUpdated.removeListener(listener);
					resolve();
				}, 15e3);
			});
		});
	}
	async function ensureOffscreen() {
		if (offscreenPort) return;
		if (offscreenCreating) return offscreenCreating;
		offscreenCreating = (async () => {
			if ((await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] })).length === 0) await chrome.offscreen.createDocument({
				url: chrome.runtime.getURL("offscreen.html"),
				reasons: ["USER_MEDIA"],
				justification: "LiveKit WebRTC via tabCapture for auth session streaming"
			});
			await new Promise((resolve) => {
				const check = setInterval(() => {
					if (offscreenPort) {
						clearInterval(check);
						resolve();
					}
				}, 50);
			});
		})();
		await offscreenCreating;
		offscreenCreating = null;
	}
	async function startLiveKitCapture(tabId, streamId, opts) {
		const tab = await chrome.tabs.get(tabId);
		console.log("[authloop] tab info — url:", tab.url, "status:", tab.status, "size:", tab.width, "x", tab.height);
		let dpr = 1;
		try {
			const [{ result }] = await chrome.scripting.executeScript({
				target: { tabId },
				func: () => window.devicePixelRatio ?? 1
			});
			dpr = result;
			console.log("[authloop] DPR:", dpr);
		} catch (e) {
			console.warn("[authloop] failed to get DPR:", e);
		}
		console.log("[authloop] stream ID from popup:", streamId.slice(0, 20) + "...");
		console.log("[authloop] ensuring offscreen document...");
		await ensureOffscreen();
		console.log("[authloop] offscreen document ready, sending START_LIVEKIT");
		offscreenPort?.postMessage({
			type: "START_LIVEKIT",
			streamId,
			sessionId: opts.sessionId,
			livekitUrl: opts.livekitUrl,
			livekitToken: opts.livekitToken,
			cssWidth: tab.width ?? 1280,
			cssHeight: tab.height ?? 720,
			pixelRatio: dpr
		});
	}
	async function ensureDebugger(tabId) {
		if (dbg.attached && dbg.tabId === tabId) return;
		if (dbg.attached) try {
			await chrome.debugger.detach({ tabId: dbg.tabId });
		} catch {}
		await chrome.debugger.attach({ tabId }, "1.3");
		Object.assign(dbg, {
			attached: true,
			tabId
		});
	}
	function scheduleDetach(tabId, ms = 3e3) {
		clearTimeout(dbg.detachTimer);
		dbg.detachTimer = setTimeout(async () => {
			if (!dbg.attached || dbg.tabId !== tabId) return;
			try {
				await chrome.debugger.detach({ tabId });
			} catch {}
			Object.assign(dbg, {
				attached: false,
				tabId: 0
			});
		}, ms);
	}
	async function handleInputEvent(msg) {
		const session = await getPersistedSession();
		if (!session?.tabId) return;
		const tabId = session.tabId;
		try {
			switch (msg.type) {
				case "click":
					if (!Number.isFinite(msg.x) || !Number.isFinite(msg.y)) return;
					await ensureDebugger(tabId);
					await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
						type: "mousePressed",
						x: msg.x,
						y: msg.y,
						button: "left",
						clickCount: 1,
						modifiers: 0
					});
					await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
						type: "mouseReleased",
						x: msg.x,
						y: msg.y,
						button: "left",
						clickCount: 1,
						modifiers: 0
					});
					scheduleDetach(tabId);
					break;
				case "keydown":
					await ensureDebugger(tabId);
					await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
						type: "rawKeyDown",
						key: msg.key,
						code: msg.code,
						text: msg.key?.length === 1 ? msg.key : void 0,
						modifiers: msg.modifiers ?? 0,
						windowsVirtualKeyCode: msg.keyCode ?? 0
					});
					scheduleDetach(tabId);
					break;
				case "keyup":
					await ensureDebugger(tabId);
					await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
						type: "keyUp",
						key: msg.key,
						code: msg.code,
						modifiers: msg.modifiers ?? 0,
						windowsVirtualKeyCode: msg.keyCode ?? 0
					});
					scheduleDetach(tabId);
					break;
				case "keypress":
					if (!msg.key || msg.key.length !== 1) return;
					await ensureDebugger(tabId);
					await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
						type: "char",
						text: msg.key,
						modifiers: msg.modifiers ?? 0
					});
					scheduleDetach(tabId);
					break;
				case "scroll":
					if (!Number.isFinite(msg.x) || !Number.isFinite(msg.y)) return;
					await ensureDebugger(tabId);
					await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
						type: "mouseWheel",
						x: msg.x,
						y: msg.y,
						deltaX: msg.deltaX ?? 0,
						deltaY: msg.deltaY ?? 0
					});
					scheduleDetach(tabId);
					break;
				case "paste":
					if (typeof msg.text !== "string" || msg.text.length > 1e4) return;
					await ensureDebugger(tabId);
					await chrome.debugger.sendCommand({ tabId }, "Input.insertText", { text: msg.text });
					scheduleDetach(tabId);
					break;
				case "resolved":
					await resolveActiveSession();
					break;
				case "cancelled":
					ws$1?.send(JSON.stringify({
						type: "session_error",
						session_id: session.sessionId,
						error: "cancelled"
					}));
					await clearSession();
					break;
			}
		} catch (e) {
			console.error("[authloop] input dispatch error:", e);
		}
	}
	async function refreshAccessToken() {
		const { refreshToken, deviceId } = await chrome.storage.local.get(["refreshToken", "deviceId"]);
		if (!refreshToken || !deviceId) return;
		const apiBase = await getApiBase();
		try {
			const res = await fetch(`${apiBase}/extension/refresh`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					refresh_token: refreshToken,
					device_id: deviceId
				})
			});
			if (!res.ok) {
				if (res.status === 401) {
					await chrome.storage.local.remove([
						"accessToken",
						"refreshToken",
						"deviceId",
						"userId"
					]);
					ws$1?.close();
				}
				return;
			}
			const data = await res.json();
			await chrome.storage.local.set({ accessToken: data.access_token });
			connect();
		} catch {}
	}
	async function getState() {
		const { accessToken, deviceId, userId } = await chrome.storage.local.get([
			"accessToken",
			"deviceId",
			"userId"
		]);
		const session = await getPersistedSession();
		return {
			paired: !!(accessToken && deviceId),
			connected: ws$1?.readyState === WebSocket.OPEN,
			userId,
			activeSession: session
		};
	}
	var background_default = defineBackground(async () => {
		chrome.runtime.onConnect.addListener((port) => {
			if (port.name !== "authloop-offscreen") return;
			offscreenPort = port;
			port.onMessage.addListener((msg) => {
				if (msg.type === "HEARTBEAT") return;
				if (msg.type === "TRACK_ENDED") handleTrackEnded(msg.sessionId);
				if (msg.type === "LIVEKIT_CONNECTED") console.log("[authloop] LiveKit streaming for", msg.sessionId);
				if (msg.type === "LIVEKIT_ERROR") console.error("[authloop] LiveKit error:", msg.error);
				if ([
					"click",
					"dblclick",
					"keydown",
					"keyup",
					"keypress",
					"scroll",
					"paste",
					"resolved",
					"cancelled"
				].includes(msg.type)) handleInputEvent(msg);
			});
			port.onDisconnect.addListener(() => {
				offscreenPort = null;
				offscreenCreating = null;
			});
		});
		chrome.debugger.onDetach.addListener((source, reason) => {
			if (source.tabId === dbg.tabId) {
				console.warn("[authloop] debugger detached:", reason);
				clearTimeout(dbg.detachTimer);
				Object.assign(dbg, {
					attached: false,
					tabId: 0
				});
			}
		});
		if (await getPersistedSession()) {
			chrome.action.setBadgeText({ text: "●" });
			chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
			chrome.alarms.create("keepalive", { periodInMinutes: 25 / 60 });
		}
		connect();
	});
	//#endregion
	//#region ../../node_modules/.pnpm/wxt@0.20.20_@types+node@22.19.15_jiti@2.6.1_tsx@4.21.0/node_modules/wxt/dist/browser.mjs
	/**
	* Contains the `browser` export which you should use to access the extension
	* APIs in your project:
	*
	* ```ts
	* import { browser } from 'wxt/browser';
	*
	* browser.runtime.onInstalled.addListener(() => {
	*   // ...
	* });
	* ```
	*
	* @module wxt/browser
	*/
	var browser = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;
	//#endregion
	//#region ../../node_modules/.pnpm/@webext-core+match-patterns@1.0.3/node_modules/@webext-core/match-patterns/lib/index.js
	var _MatchPattern = class {
		constructor(matchPattern) {
			if (matchPattern === "<all_urls>") {
				this.isAllUrls = true;
				this.protocolMatches = [..._MatchPattern.PROTOCOLS];
				this.hostnameMatch = "*";
				this.pathnameMatch = "*";
			} else {
				const groups = /(.*):\/\/(.*?)(\/.*)/.exec(matchPattern);
				if (groups == null) throw new InvalidMatchPattern(matchPattern, "Incorrect format");
				const [_, protocol, hostname, pathname] = groups;
				validateProtocol(matchPattern, protocol);
				validateHostname(matchPattern, hostname);
				validatePathname(matchPattern, pathname);
				this.protocolMatches = protocol === "*" ? ["http", "https"] : [protocol];
				this.hostnameMatch = hostname;
				this.pathnameMatch = pathname;
			}
		}
		includes(url) {
			if (this.isAllUrls) return true;
			const u = typeof url === "string" ? new URL(url) : url instanceof Location ? new URL(url.href) : url;
			return !!this.protocolMatches.find((protocol) => {
				if (protocol === "http") return this.isHttpMatch(u);
				if (protocol === "https") return this.isHttpsMatch(u);
				if (protocol === "file") return this.isFileMatch(u);
				if (protocol === "ftp") return this.isFtpMatch(u);
				if (protocol === "urn") return this.isUrnMatch(u);
			});
		}
		isHttpMatch(url) {
			return url.protocol === "http:" && this.isHostPathMatch(url);
		}
		isHttpsMatch(url) {
			return url.protocol === "https:" && this.isHostPathMatch(url);
		}
		isHostPathMatch(url) {
			if (!this.hostnameMatch || !this.pathnameMatch) return false;
			const hostnameMatchRegexs = [this.convertPatternToRegex(this.hostnameMatch), this.convertPatternToRegex(this.hostnameMatch.replace(/^\*\./, ""))];
			const pathnameMatchRegex = this.convertPatternToRegex(this.pathnameMatch);
			return !!hostnameMatchRegexs.find((regex) => regex.test(url.hostname)) && pathnameMatchRegex.test(url.pathname);
		}
		isFileMatch(url) {
			throw Error("Not implemented: file:// pattern matching. Open a PR to add support");
		}
		isFtpMatch(url) {
			throw Error("Not implemented: ftp:// pattern matching. Open a PR to add support");
		}
		isUrnMatch(url) {
			throw Error("Not implemented: urn:// pattern matching. Open a PR to add support");
		}
		convertPatternToRegex(pattern) {
			const starsReplaced = this.escapeForRegex(pattern).replace(/\\\*/g, ".*");
			return RegExp(`^${starsReplaced}$`);
		}
		escapeForRegex(string) {
			return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		}
	};
	var MatchPattern = _MatchPattern;
	MatchPattern.PROTOCOLS = [
		"http",
		"https",
		"file",
		"ftp",
		"urn"
	];
	var InvalidMatchPattern = class extends Error {
		constructor(matchPattern, reason) {
			super(`Invalid match pattern "${matchPattern}": ${reason}`);
		}
	};
	function validateProtocol(matchPattern, protocol) {
		if (!MatchPattern.PROTOCOLS.includes(protocol) && protocol !== "*") throw new InvalidMatchPattern(matchPattern, `${protocol} not a valid protocol (${MatchPattern.PROTOCOLS.join(", ")})`);
	}
	function validateHostname(matchPattern, hostname) {
		if (hostname.includes(":")) throw new InvalidMatchPattern(matchPattern, `Hostname cannot include a port`);
		if (hostname.includes("*") && hostname.length > 1 && !hostname.startsWith("*.")) throw new InvalidMatchPattern(matchPattern, `If using a wildcard (*), it must go at the start of the hostname`);
	}
	function validatePathname(matchPattern, pathname) {}
	//#endregion
	//#region \0virtual:wxt-background-entrypoint?/Users/gokul/Work/authloop/authloop/packages/extension/src/entrypoints/background.ts
	function print(method, ...args) {
		if (typeof args[0] === "string") method(`[wxt] ${args.shift()}`, ...args);
		else method("[wxt]", ...args);
	}
	/** Wrapper around `console` with a "[wxt]" prefix */
	var logger = {
		debug: (...args) => print(console.debug, ...args),
		log: (...args) => print(console.log, ...args),
		warn: (...args) => print(console.warn, ...args),
		error: (...args) => print(console.error, ...args)
	};
	var ws;
	/** Connect to the websocket and listen for messages. */
	function getDevServerWebSocket() {
		if (ws == null) {
			const serverUrl = "ws://localhost:3001";
			logger.debug("Connecting to dev server @", serverUrl);
			ws = new WebSocket(serverUrl, "vite-hmr");
			ws.addWxtEventListener = ws.addEventListener.bind(ws);
			ws.sendCustom = (event, payload) => ws?.send(JSON.stringify({
				type: "custom",
				event,
				payload
			}));
			ws.addEventListener("open", () => {
				logger.debug("Connected to dev server");
			});
			ws.addEventListener("close", () => {
				logger.debug("Disconnected from dev server");
			});
			ws.addEventListener("error", (event) => {
				logger.error("Failed to connect to dev server", event);
			});
			ws.addEventListener("message", (e) => {
				try {
					const message = JSON.parse(e.data);
					if (message.type === "custom") ws?.dispatchEvent(new CustomEvent(message.event, { detail: message.data }));
				} catch (err) {
					logger.error("Failed to handle message", err);
				}
			});
		}
		return ws;
	}
	/** https://developer.chrome.com/blog/longer-esw-lifetimes/ */
	function keepServiceWorkerAlive() {
		setInterval(async () => {
			await browser.runtime.getPlatformInfo();
		}, 5e3);
	}
	function reloadContentScript(payload) {
		if (browser.runtime.getManifest().manifest_version == 2) reloadContentScriptMv2(payload);
		else reloadContentScriptMv3(payload);
	}
	async function reloadContentScriptMv3({ registration, contentScript }) {
		if (registration === "runtime") await reloadRuntimeContentScriptMv3(contentScript);
		else await reloadManifestContentScriptMv3(contentScript);
	}
	async function reloadManifestContentScriptMv3(contentScript) {
		const id = `wxt:${contentScript.js[0]}`;
		logger.log("Reloading content script:", contentScript);
		const registered = await browser.scripting.getRegisteredContentScripts();
		logger.debug("Existing scripts:", registered);
		const existing = registered.find((cs) => cs.id === id);
		if (existing) {
			logger.debug("Updating content script", existing);
			await browser.scripting.updateContentScripts([{
				...contentScript,
				id,
				css: contentScript.css ?? []
			}]);
		} else {
			logger.debug("Registering new content script...");
			await browser.scripting.registerContentScripts([{
				...contentScript,
				id,
				css: contentScript.css ?? []
			}]);
		}
		await reloadTabsForContentScript(contentScript);
	}
	async function reloadRuntimeContentScriptMv3(contentScript) {
		logger.log("Reloading content script:", contentScript);
		const registered = await browser.scripting.getRegisteredContentScripts();
		logger.debug("Existing scripts:", registered);
		const matches = registered.filter((cs) => {
			const hasJs = contentScript.js?.find((js) => cs.js?.includes(js));
			const hasCss = contentScript.css?.find((css) => cs.css?.includes(css));
			return hasJs || hasCss;
		});
		if (matches.length === 0) {
			logger.log("Content script is not registered yet, nothing to reload", contentScript);
			return;
		}
		await browser.scripting.updateContentScripts(matches);
		await reloadTabsForContentScript(contentScript);
	}
	async function reloadTabsForContentScript(contentScript) {
		const allTabs = await browser.tabs.query({});
		const matchPatterns = contentScript.matches.map((match) => new MatchPattern(match));
		const matchingTabs = allTabs.filter((tab) => {
			const url = tab.url;
			if (!url) return false;
			return !!matchPatterns.find((pattern) => pattern.includes(url));
		});
		await Promise.all(matchingTabs.map(async (tab) => {
			try {
				await browser.tabs.reload(tab.id);
			} catch (err) {
				logger.warn("Failed to reload tab:", err);
			}
		}));
	}
	async function reloadContentScriptMv2(_payload) {
		throw Error("TODO: reloadContentScriptMv2");
	}
	try {
		const ws = getDevServerWebSocket();
		ws.addWxtEventListener("wxt:reload-extension", () => {
			browser.runtime.reload();
		});
		ws.addWxtEventListener("wxt:reload-content-script", (event) => {
			reloadContentScript(event.detail);
		});
		ws.addEventListener("open", () => ws.sendCustom("wxt:background-initialized"));
		keepServiceWorkerAlive();
	} catch (err) {
		logger.error("Failed to setup web socket connection with dev server", err);
	}
	browser.commands.onCommand.addListener((command) => {
		if (command === "wxt:reload-extension") browser.runtime.reload();
	});
	var result;
	try {
		result = background_default.main();
		if (result instanceof Promise) console.warn("The background's main() function return a promise, but it must be synchronous");
	} catch (err) {
		logger.error("The background crashed on startup!");
		throw err;
	}
	//#endregion
	return result;
})();

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFja2dyb3VuZC5qcyIsIm5hbWVzIjpbImJyb3dzZXIiXSwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9ub2RlX21vZHVsZXMvLnBucG0vd3h0QDAuMjAuMjBfQHR5cGVzK25vZGVAMjIuMTkuMTVfaml0aUAyLjYuMV90c3hANC4yMS4wL25vZGVfbW9kdWxlcy93eHQvZGlzdC91dGlscy9kZWZpbmUtYmFja2dyb3VuZC5tanMiLCIuLi8uLi9zcmMvZW50cnlwb2ludHMvYmFja2dyb3VuZC50cyIsIi4uLy4uLy4uLy4uL25vZGVfbW9kdWxlcy8ucG5wbS9Ad3h0LWRlditicm93c2VyQDAuMS4zOC9ub2RlX21vZHVsZXMvQHd4dC1kZXYvYnJvd3Nlci9zcmMvaW5kZXgubWpzIiwiLi4vLi4vLi4vLi4vbm9kZV9tb2R1bGVzLy5wbnBtL3d4dEAwLjIwLjIwX0B0eXBlcytub2RlQDIyLjE5LjE1X2ppdGlAMi42LjFfdHN4QDQuMjEuMC9ub2RlX21vZHVsZXMvd3h0L2Rpc3QvYnJvd3Nlci5tanMiLCIuLi8uLi8uLi8uLi9ub2RlX21vZHVsZXMvLnBucG0vQHdlYmV4dC1jb3JlK21hdGNoLXBhdHRlcm5zQDEuMC4zL25vZGVfbW9kdWxlcy9Ad2ViZXh0LWNvcmUvbWF0Y2gtcGF0dGVybnMvbGliL2luZGV4LmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8vI3JlZ2lvbiBzcmMvdXRpbHMvZGVmaW5lLWJhY2tncm91bmQudHNcbmZ1bmN0aW9uIGRlZmluZUJhY2tncm91bmQoYXJnKSB7XG5cdGlmIChhcmcgPT0gbnVsbCB8fCB0eXBlb2YgYXJnID09PSBcImZ1bmN0aW9uXCIpIHJldHVybiB7IG1haW46IGFyZyB9O1xuXHRyZXR1cm4gYXJnO1xufVxuLy8jZW5kcmVnaW9uXG5leHBvcnQgeyBkZWZpbmVCYWNrZ3JvdW5kIH07XG4iLCIvLyBTZXJ2aWNlIHdvcmtlcjogbWFuYWdlcyBXU1MgY29ubmVjdGlvbiwgc2Vzc2lvbiBsaWZlY3ljbGUsIExpdmVLaXQgY2FwdHVyZSwgaW5wdXQgZGlzcGF0Y2hcbi8vXG4vLyBNVjMgY29uc3RyYWludHM6XG4vLyAtIEFsbCBjaHJvbWUuKiBsaXN0ZW5lcnMgcmVnaXN0ZXJlZCBhdCB0b3AgbGV2ZWxcbi8vIC0gY2hyb21lLmFsYXJtcyBmb3IgYWxsIHRpbWVyc1xuLy8gLSBhY3RpdmVTZXNzaW9uIHBlcnNpc3RlZCBpbiBjaHJvbWUuc3RvcmFnZS5zZXNzaW9uXG4vLyAtIEtlZXBhbGl2ZSBhbGFybSBkdXJpbmcgYWN0aXZlIHNlc3Npb25zXG4vLyAtIE9mZnNjcmVlbiBkb2N1bWVudCBmb3IgTGl2ZUtpdCAobmVlZHMgRE9NIGNvbnRleHQpXG4vLyAtIGNocm9tZS5kZWJ1Z2dlciBmb3IgaW5wdXQgZGlzcGF0Y2ggKGxhenkgYXR0YWNoL2RldGFjaClcblxuaW1wb3J0IHR5cGUgeyBCYWNrZW5kVG9FeHRlbnNpb25NZXNzYWdlIH0gZnJvbSAnQGF1dGhsb29wLWFpL2NvcmUnO1xuXG5jb25zdCBERUZBVUxUX0FQSV9CQVNFID0gJ2h0dHBzOi8vYXBpLmF1dGhsb29wLmFpJztcblxuaW50ZXJmYWNlIEFjdGl2ZVNlc3Npb24ge1xuICBzZXNzaW9uSWQ6IHN0cmluZztcbiAgc2VydmljZTogc3RyaW5nO1xuICBjb250ZXh0PzogeyB1cmw/OiBzdHJpbmc7IGJsb2NrZXJfdHlwZT86IHN0cmluZzsgaGludD86IHN0cmluZyB9O1xuICBleHBpcmVzQXQ6IHN0cmluZztcbiAgdGFiSWQ/OiBudW1iZXI7XG4gIGxpdmVraXRSb29tPzogc3RyaW5nO1xuICBsaXZla2l0VXJsPzogc3RyaW5nO1xuICBsaXZla2l0VG9rZW4/OiBzdHJpbmc7XG4gIGNhcHR1cmluZz86IGJvb2xlYW47XG59XG5cbmxldCB3czogV2ViU29ja2V0IHwgbnVsbCA9IG51bGw7XG5sZXQgcmVjb25uZWN0QXR0ZW1wdHMgPSAwO1xubGV0IG9mZnNjcmVlblBvcnQ6IGNocm9tZS5ydW50aW1lLlBvcnQgfCBudWxsID0gbnVsbDtcbmxldCBvZmZzY3JlZW5DcmVhdGluZzogUHJvbWlzZTx2b2lkPiB8IG51bGwgPSBudWxsO1xuXG4vLyBEZWJ1Z2dlciBzdGF0ZVxuY29uc3QgZGJnID0geyBhdHRhY2hlZDogZmFsc2UsIHRhYklkOiAwLCBkZXRhY2hUaW1lcjogMCBhcyBSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB9O1xuXG4vLyDilIDilIDilIAgQWxsIGNocm9tZS4qIGxpc3RlbmVycyBhdCB0b3AgbGV2ZWwgKE1WMyByZXF1aXJlbWVudCkg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbmNocm9tZS5ydW50aW1lLm9uSW5zdGFsbGVkLmFkZExpc3RlbmVyKCgpID0+IHtcbiAgY2hyb21lLmFsYXJtcy5jcmVhdGUoJ3Rva2VuLXJlZnJlc2gnLCB7IHBlcmlvZEluTWludXRlczogNTAgfSk7XG59KTtcblxuY2hyb21lLmFsYXJtcy5vbkFsYXJtLmFkZExpc3RlbmVyKGFzeW5jIChhbGFybSkgPT4ge1xuICBzd2l0Y2ggKGFsYXJtLm5hbWUpIHtcbiAgICBjYXNlICd0b2tlbi1yZWZyZXNoJzogYXdhaXQgcmVmcmVzaEFjY2Vzc1Rva2VuKCk7IGJyZWFrO1xuICAgIGNhc2UgJ3JlY29ubmVjdCc6IGF3YWl0IGNvbm5lY3QoKTsgYnJlYWs7XG4gICAgY2FzZSAna2VlcGFsaXZlJzpcbiAgICAgIGlmICh3cz8ucmVhZHlTdGF0ZSAhPT0gV2ViU29ja2V0Lk9QRU4pIGF3YWl0IGNvbm5lY3QoKTtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ3Nlc3Npb24tdGltZW91dCc6IHtcbiAgICAgIGNvbnN0IHNlc3Npb24gPSBhd2FpdCBnZXRQZXJzaXN0ZWRTZXNzaW9uKCk7XG4gICAgICBpZiAoc2Vzc2lvbikge1xuICAgICAgICBhd2FpdCBjbGVhclNlc3Npb24oKTtcbiAgICAgICAgd3M/LnNlbmQoSlNPTi5zdHJpbmdpZnkoeyB0eXBlOiAnc2Vzc2lvbl9lcnJvcicsIHNlc3Npb25faWQ6IHNlc3Npb24uc2Vzc2lvbklkLCBlcnJvcjogJ3RpbWVvdXQnIH0pKTtcbiAgICAgIH1cbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxufSk7XG5cbmNocm9tZS5ydW50aW1lLm9uU3RhcnR1cC5hZGRMaXN0ZW5lcigoKSA9PiB7IGNvbm5lY3QoKTsgfSk7XG5cbi8vIE1lc3NhZ2VzIGZyb20gcG9wdXBcbmNocm9tZS5ydW50aW1lLm9uTWVzc2FnZS5hZGRMaXN0ZW5lcigobXNnLCBfc2VuZGVyLCBzZW5kUmVzcG9uc2UpID0+IHtcbiAgaWYgKG1zZy50eXBlID09PSAnR0VUX1NUQVRFJykgeyBnZXRTdGF0ZSgpLnRoZW4oc2VuZFJlc3BvbnNlKTsgcmV0dXJuIHRydWU7IH1cbiAgaWYgKG1zZy50eXBlID09PSAnUkVDT05ORUNUJykgeyBjb25uZWN0KCk7IH1cbiAgaWYgKG1zZy50eXBlID09PSAnUkVTT0xWRV9TRVNTSU9OJykgeyByZXNvbHZlQWN0aXZlU2Vzc2lvbigpOyB9XG4gIGlmIChtc2cudHlwZSA9PT0gJ1NUQVJUX0NBUFRVUkUnKSB7XG4gICAgLy8gVHJpZ2dlcmVkIGJ5IHVzZXIgZ2VzdHVyZSBmcm9tIHBvcHVwIOKAlCB0YWJDYXB0dXJlIHJlcXVpcmVzIHRoaXNcbiAgICBoYW5kbGVTdGFydENhcHR1cmUobXNnLnN0cmVhbUlkKS50aGVuKHNlbmRSZXNwb25zZSk7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cbn0pO1xuXG4vLyBOb3RpZmljYXRpb24gY2xpY2tcbmNocm9tZS5ub3RpZmljYXRpb25zLm9uQ2xpY2tlZC5hZGRMaXN0ZW5lcihhc3luYyAobm90aWZJZCkgPT4ge1xuICBpZiAobm90aWZJZC5zdGFydHNXaXRoKCdzZXNzaW9uLScpKSB7XG4gICAgaWYgKGNocm9tZS5hY3Rpb24ub3BlblBvcHVwKSBjaHJvbWUuYWN0aW9uLm9wZW5Qb3B1cCgpLmNhdGNoKCgpID0+IHt9KTtcbiAgfVxufSk7XG5cbi8vIFBvcnQgZnJvbSBvZmZzY3JlZW4gZG9jdW1lbnQgKyBkZWJ1Z2dlciBkZXRhY2gg4oCUIHJlZ2lzdGVyZWQgaW4gZGVmaW5lQmFja2dyb3VuZFxuLy8gYmVjYXVzZSBXWFQncyBmYWtlIGJyb3dzZXIgKHVzZWQgYXQgYnVpbGQgdGltZSkgZG9lc24ndCBtb2NrIG9uQ29ubmVjdC9vbkRldGFjaC5cblxuLy8g4pSA4pSA4pSAIFdTUyBDb25uZWN0aW9uIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuXG5hc3luYyBmdW5jdGlvbiBnZXRBcGlCYXNlKCk6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IHsgYXBpQmFzZVVybCB9ID0gYXdhaXQgY2hyb21lLnN0b3JhZ2UubG9jYWwuZ2V0KCdhcGlCYXNlVXJsJyk7XG4gIHJldHVybiBhcGlCYXNlVXJsIHx8IERFRkFVTFRfQVBJX0JBU0U7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGNvbm5lY3QoKSB7XG4gIGNvbnN0IHsgYWNjZXNzVG9rZW4gfSA9IGF3YWl0IGNocm9tZS5zdG9yYWdlLmxvY2FsLmdldChbJ2FjY2Vzc1Rva2VuJ10pO1xuICBpZiAoIWFjY2Vzc1Rva2VuKSByZXR1cm47XG5cbiAgaWYgKHdzKSB7IHdzLm9uY2xvc2UgPSBudWxsOyB3cy5jbG9zZSgpOyB3cyA9IG51bGw7IH1cblxuICBjb25zdCBhcGlCYXNlID0gYXdhaXQgZ2V0QXBpQmFzZSgpO1xuICBjb25zdCB3c1VybCA9IGFwaUJhc2UucmVwbGFjZSgvXmh0dHAvLCAnd3MnKSArIGAvZXh0ZW5zaW9uL3dzP3Rva2VuPSR7ZW5jb2RlVVJJQ29tcG9uZW50KGFjY2Vzc1Rva2VuKX1gO1xuXG4gIHRyeSB7IHdzID0gbmV3IFdlYlNvY2tldCh3c1VybCk7IH0gY2F0Y2ggeyBzY2hlZHVsZVJlY29ubmVjdCgpOyByZXR1cm47IH1cblxuICB3cy5vbm9wZW4gPSAoKSA9PiB7XG4gICAgY29uc29sZS5sb2coJ1thdXRobG9vcF0gV1NTIGNvbm5lY3RlZCcpO1xuICAgIHJlY29ubmVjdEF0dGVtcHRzID0gMDtcbiAgICBjaHJvbWUuYWxhcm1zLmNsZWFyKCdyZWNvbm5lY3QnKTtcbiAgfTtcblxuICB3cy5vbm1lc3NhZ2UgPSAoeyBkYXRhIH0pID0+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgbXNnID0gSlNPTi5wYXJzZShkYXRhIGFzIHN0cmluZyk7XG4gICAgICBpZiAobXNnLnR5cGUgPT09ICdkZXZpY2VfcmV2b2tlZCcpIHsgaGFuZGxlRGV2aWNlUmV2b2tlZCgpOyByZXR1cm47IH1cbiAgICAgIGhhbmRsZUJhY2tlbmRNZXNzYWdlKG1zZyBhcyBCYWNrZW5kVG9FeHRlbnNpb25NZXNzYWdlKTtcbiAgICB9IGNhdGNoIChlKSB7IGNvbnNvbGUuZXJyb3IoJ1thdXRobG9vcF0gcGFyc2UgZXJyb3I6JywgZSk7IH1cbiAgfTtcblxuICB3cy5vbmNsb3NlID0gKGV2ZW50KSA9PiB7XG4gICAgd3MgPSBudWxsO1xuICAgIGlmIChldmVudC5jb2RlID09PSA0MDAxKSB7IGhhbmRsZURldmljZVJldm9rZWQoKTsgcmV0dXJuOyB9XG4gICAgc2NoZWR1bGVSZWNvbm5lY3QoKTtcbiAgfTtcblxuICB3cy5vbmVycm9yID0gKCkgPT4ge307XG59XG5cbmZ1bmN0aW9uIHNjaGVkdWxlUmVjb25uZWN0KCkge1xuICByZWNvbm5lY3RBdHRlbXB0cysrO1xuICBjb25zdCBkZWxheVNlYyA9IE1hdGgubWluKE1hdGgucG93KDIsIHJlY29ubmVjdEF0dGVtcHRzIC0gMSksIDMwKTtcbiAgY2hyb21lLmFsYXJtcy5jcmVhdGUoJ3JlY29ubmVjdCcsIHsgd2hlbjogRGF0ZS5ub3coKSArIGRlbGF5U2VjICogMTAwMCB9KTtcbn1cblxuLy8g4pSA4pSA4pSAIERldmljZSByZXZvY2F0aW9uIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuXG5hc3luYyBmdW5jdGlvbiBoYW5kbGVEZXZpY2VSZXZva2VkKCkge1xuICBhd2FpdCBjaHJvbWUuc3RvcmFnZS5sb2NhbC5yZW1vdmUoWydhY2Nlc3NUb2tlbicsICdyZWZyZXNoVG9rZW4nLCAnZGV2aWNlSWQnLCAndXNlcklkJ10pO1xuICBhd2FpdCBjbGVhclNlc3Npb24oKTtcbiAgY2hyb21lLmFsYXJtcy5jbGVhcigncmVjb25uZWN0Jyk7XG4gIGNocm9tZS5hbGFybXMuY2xlYXIoJ3Rva2VuLXJlZnJlc2gnKTtcbiAgaWYgKHdzKSB7IHdzLm9uY2xvc2UgPSBudWxsOyB3cy5jbG9zZSgpOyB3cyA9IG51bGw7IH1cbn1cblxuLy8g4pSA4pSA4pSAIFNlc3Npb24gcGVyc2lzdGVuY2Ug4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbmFzeW5jIGZ1bmN0aW9uIGdldFBlcnNpc3RlZFNlc3Npb24oKTogUHJvbWlzZTxBY3RpdmVTZXNzaW9uIHwgbnVsbD4ge1xuICBjb25zdCB7IGFjdGl2ZVNlc3Npb24gfSA9IGF3YWl0IGNocm9tZS5zdG9yYWdlLnNlc3Npb24uZ2V0KCdhY3RpdmVTZXNzaW9uJyk7XG4gIHJldHVybiBhY3RpdmVTZXNzaW9uIHx8IG51bGw7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHBlcnNpc3RTZXNzaW9uKHNlc3Npb246IEFjdGl2ZVNlc3Npb24gfCBudWxsKSB7XG4gIGlmIChzZXNzaW9uKSBhd2FpdCBjaHJvbWUuc3RvcmFnZS5zZXNzaW9uLnNldCh7IGFjdGl2ZVNlc3Npb246IHNlc3Npb24gfSk7XG4gIGVsc2UgYXdhaXQgY2hyb21lLnN0b3JhZ2Uuc2Vzc2lvbi5yZW1vdmUoJ2FjdGl2ZVNlc3Npb24nKTtcbn1cblxuLy8g4pSA4pSA4pSAIFNlc3Npb24gaGFuZGxpbmcg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZUJhY2tlbmRNZXNzYWdlKG1zZzogQmFja2VuZFRvRXh0ZW5zaW9uTWVzc2FnZSkge1xuICBpZiAobXNnLnR5cGUgPT09ICdzdGFydF9zZXNzaW9uJykge1xuICAgIGNvbnNvbGUubG9nKCdbYXV0aGxvb3BdIHN0YXJ0X3Nlc3Npb246JywgbXNnLnNlc3Npb25faWQsIG1zZy5zZXJ2aWNlKTtcblxuICAgIGNvbnN0IHNlc3Npb246IEFjdGl2ZVNlc3Npb24gPSB7XG4gICAgICBzZXNzaW9uSWQ6IG1zZy5zZXNzaW9uX2lkLFxuICAgICAgc2VydmljZTogbXNnLnNlcnZpY2UsXG4gICAgICBjb250ZXh0OiBtc2cuY29udGV4dCxcbiAgICAgIGV4cGlyZXNBdDogbXNnLmV4cGlyZXNfYXQsXG4gICAgICBsaXZla2l0Um9vbTogbXNnLmxpdmVraXRfcm9vbSxcbiAgICB9O1xuXG4gICAgYXdhaXQgcGVyc2lzdFNlc3Npb24oc2Vzc2lvbik7XG5cbiAgICAvLyBLZWVwYWxpdmUgKyB0aW1lb3V0IGFsYXJtc1xuICAgIGNocm9tZS5hbGFybXMuY3JlYXRlKCdrZWVwYWxpdmUnLCB7IHBlcmlvZEluTWludXRlczogMjUgLyA2MCB9KTtcbiAgICBjb25zdCB0dGxNcyA9IG5ldyBEYXRlKG1zZy5leHBpcmVzX2F0KS5nZXRUaW1lKCkgLSBEYXRlLm5vdygpO1xuICAgIGlmICh0dGxNcyA+IDApIGNocm9tZS5hbGFybXMuY3JlYXRlKCdzZXNzaW9uLXRpbWVvdXQnLCB7IHdoZW46IERhdGUubm93KCkgKyB0dGxNcyB9KTtcblxuICAgIC8vIE5vdGlmaWNhdGlvblxuICAgIGNocm9tZS5ub3RpZmljYXRpb25zLmNyZWF0ZShgc2Vzc2lvbi0ke21zZy5zZXNzaW9uX2lkfWAsIHtcbiAgICAgIHR5cGU6ICdiYXNpYycsXG4gICAgICBpY29uVXJsOiBjaHJvbWUucnVudGltZS5nZXRVUkwoJ2ljb24tMTI4LnBuZycpLFxuICAgICAgdGl0bGU6ICdBdXRoTG9vcCDigJQgQXV0aCBSZXF1aXJlZCcsXG4gICAgICBtZXNzYWdlOiBgJHttc2cuc2VydmljZX0gbmVlZHMgYXV0aGVudGljYXRpb24ke21zZy5jb250ZXh0Py5oaW50ID8gJzogJyArIG1zZy5jb250ZXh0LmhpbnQgOiAnJ30uIENsaWNrIHRvIHJlc29sdmUuYCxcbiAgICAgIHByaW9yaXR5OiAyLFxuICAgICAgcmVxdWlyZUludGVyYWN0aW9uOiB0cnVlLFxuICAgIH0pO1xuXG4gICAgLy8gQmFkZ2VcbiAgICBjaHJvbWUuYWN0aW9uLnNldEJhZGdlVGV4dCh7IHRleHQ6ICdcXHUyNUNGJyB9KTtcbiAgICBjaHJvbWUuYWN0aW9uLnNldEJhZGdlQmFja2dyb3VuZENvbG9yKHsgY29sb3I6ICcjZWY0NDQ0JyB9KTtcblxuICAgIC8vIEZpbmQvb3BlbiB0YXJnZXQgdGFiXG4gICAgY29uc29sZS5sb2coJ1thdXRobG9vcF0gZmluZGluZyB0YWIgZm9yOicsIG1zZy5jb250ZXh0Py51cmwgPz8gJ25vIFVSTCBoaW50Jyk7XG4gICAgY29uc3QgdGFiSWQgPSBhd2FpdCBmaW5kT3JPcGVuVGFiKG1zZy5jb250ZXh0Py51cmwpO1xuICAgIGNvbnNvbGUubG9nKCdbYXV0aGxvb3BdIHRhYiBmb3VuZC9vcGVuZWQ6JywgdGFiSWQpO1xuXG4gICAgaWYgKHRhYklkKSB7XG4gICAgICBzZXNzaW9uLnRhYklkID0gdGFiSWQ7XG4gICAgICAvLyBTdG9yZSBMaXZlS2l0IGNyZWRlbnRpYWxzIGZvciB3aGVuIHVzZXIgdHJpZ2dlcnMgY2FwdHVyZSBmcm9tIHBvcHVwXG4gICAgICBpZiAobXNnLmxpdmVraXRfdXJsICYmIG1zZy5saXZla2l0X3Rva2VuKSB7XG4gICAgICAgIChzZXNzaW9uIGFzIGFueSkubGl2ZWtpdFVybCA9IG1zZy5saXZla2l0X3VybDtcbiAgICAgICAgKHNlc3Npb24gYXMgYW55KS5saXZla2l0VG9rZW4gPSBtc2cubGl2ZWtpdF90b2tlbjtcbiAgICAgIH1cbiAgICAgIGF3YWl0IHBlcnNpc3RTZXNzaW9uKHNlc3Npb24pO1xuICAgICAgY29uc29sZS5sb2coJ1thdXRobG9vcF0gc2Vzc2lvbiByZWFkeSwgd2FpdGluZyBmb3IgdXNlciB0byBzdGFydCBjYXB0dXJlIGZyb20gcG9wdXAnKTtcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc29sZS53YXJuKCdbYXV0aGxvb3BdIG5vIHRhYiBmb3VuZCBmb3Igc2Vzc2lvbicpO1xuICAgIH1cblxuICAgIC8vIEFja25vd2xlZGdlXG4gICAgd3M/LnNlbmQoSlNPTi5zdHJpbmdpZnkoeyB0eXBlOiAnc2Vzc2lvbl9hY2snLCBzZXNzaW9uX2lkOiBtc2cuc2Vzc2lvbl9pZCB9KSk7XG4gIH1cblxuICBpZiAobXNnLnR5cGUgPT09ICdzdG9wX3Nlc3Npb24nKSB7XG4gICAgY29uc3Qgc2Vzc2lvbiA9IGF3YWl0IGdldFBlcnNpc3RlZFNlc3Npb24oKTtcbiAgICBpZiAoc2Vzc2lvbj8uc2Vzc2lvbklkID09PSBtc2cuc2Vzc2lvbl9pZCkgYXdhaXQgY2xlYXJTZXNzaW9uKCk7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZUFjdGl2ZVNlc3Npb24oKSB7XG4gIGNvbnN0IHNlc3Npb24gPSBhd2FpdCBnZXRQZXJzaXN0ZWRTZXNzaW9uKCk7XG4gIGlmICghc2Vzc2lvbikgcmV0dXJuO1xuICB3cz8uc2VuZChKU09OLnN0cmluZ2lmeSh7IHR5cGU6ICdhdXRoX2NvbXBsZXRlJywgc2Vzc2lvbl9pZDogc2Vzc2lvbi5zZXNzaW9uSWQgfSkpO1xuICBhd2FpdCBjbGVhclNlc3Npb24oKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gY2xlYXJTZXNzaW9uKCkge1xuICBjb25zdCBzZXNzaW9uID0gYXdhaXQgZ2V0UGVyc2lzdGVkU2Vzc2lvbigpO1xuICBpZiAoc2Vzc2lvbikge1xuICAgIGNocm9tZS5ub3RpZmljYXRpb25zLmNsZWFyKGBzZXNzaW9uLSR7c2Vzc2lvbi5zZXNzaW9uSWR9YCk7XG4gICAgb2Zmc2NyZWVuUG9ydD8ucG9zdE1lc3NhZ2UoeyB0eXBlOiAnU1RPUF9MSVZFS0lUJyB9KTtcbiAgICAvLyBEZXRhY2ggZGVidWdnZXJcbiAgICBpZiAoZGJnLmF0dGFjaGVkICYmIHNlc3Npb24udGFiSWQpIHtcbiAgICAgIHRyeSB7IGF3YWl0IGNocm9tZS5kZWJ1Z2dlci5kZXRhY2goeyB0YWJJZDogc2Vzc2lvbi50YWJJZCB9KTsgfSBjYXRjaCB7fVxuICAgICAgT2JqZWN0LmFzc2lnbihkYmcsIHsgYXR0YWNoZWQ6IGZhbHNlLCB0YWJJZDogMCB9KTtcbiAgICB9XG4gICAgY2xlYXJUaW1lb3V0KGRiZy5kZXRhY2hUaW1lcik7XG4gIH1cbiAgYXdhaXQgcGVyc2lzdFNlc3Npb24obnVsbCk7XG4gIGNocm9tZS5hY3Rpb24uc2V0QmFkZ2VUZXh0KHsgdGV4dDogJycgfSk7XG4gIGNocm9tZS5hbGFybXMuY2xlYXIoJ2tlZXBhbGl2ZScpO1xuICBjaHJvbWUuYWxhcm1zLmNsZWFyKCdzZXNzaW9uLXRpbWVvdXQnKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gaGFuZGxlVHJhY2tFbmRlZChzZXNzaW9uSWQ6IHN0cmluZykge1xuICBjb25zdCBzZXNzaW9uID0gYXdhaXQgZ2V0UGVyc2lzdGVkU2Vzc2lvbigpO1xuICBpZiAoc2Vzc2lvbj8uc2Vzc2lvbklkID09PSBzZXNzaW9uSWQpIHtcbiAgICB3cz8uc2VuZChKU09OLnN0cmluZ2lmeSh7IHR5cGU6ICdzZXNzaW9uX2Vycm9yJywgc2Vzc2lvbl9pZDogc2Vzc2lvbklkLCBlcnJvcjogJ3RhYl9jbG9zZWQnIH0pKTtcbiAgICBhd2FpdCBjbGVhclNlc3Npb24oKTtcbiAgfVxufVxuXG4vLyDilIDilIDilIAgQ2FwdHVyZSB0cmlnZ2VyIChmcm9tIHBvcHVwIHVzZXIgZ2VzdHVyZSkg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZVN0YXJ0Q2FwdHVyZShzdHJlYW1JZDogc3RyaW5nKTogUHJvbWlzZTx7IG9rOiBib29sZWFuOyBlcnJvcj86IHN0cmluZyB9PiB7XG4gIGNvbnN0IHNlc3Npb24gPSBhd2FpdCBnZXRQZXJzaXN0ZWRTZXNzaW9uKCk7XG4gIGlmICghc2Vzc2lvbikgcmV0dXJuIHsgb2s6IGZhbHNlLCBlcnJvcjogJ25vIGFjdGl2ZSBzZXNzaW9uJyB9O1xuICBpZiAoIXNlc3Npb24udGFiSWQpIHJldHVybiB7IG9rOiBmYWxzZSwgZXJyb3I6ICdubyB0YWIgSUQnIH07XG4gIGlmICghc2Vzc2lvbi5saXZla2l0VXJsIHx8ICFzZXNzaW9uLmxpdmVraXRUb2tlbikgcmV0dXJuIHsgb2s6IGZhbHNlLCBlcnJvcjogJ25vIExpdmVLaXQgY3JlZGVudGlhbHMnIH07XG4gIGlmIChzZXNzaW9uLmNhcHR1cmluZykgcmV0dXJuIHsgb2s6IHRydWUgfTsgLy8gYWxyZWFkeSBjYXB0dXJpbmdcblxuICBjb25zb2xlLmxvZygnW2F1dGhsb29wXSBzdGFydGluZyBjYXB0dXJlIGZyb20gcG9wdXAgZ2VzdHVyZSwgdGFiOicsIHNlc3Npb24udGFiSWQpO1xuICB0cnkge1xuICAgIGF3YWl0IHN0YXJ0TGl2ZUtpdENhcHR1cmUoc2Vzc2lvbi50YWJJZCwgc3RyZWFtSWQsIHtcbiAgICAgIHNlc3Npb25JZDogc2Vzc2lvbi5zZXNzaW9uSWQsXG4gICAgICBsaXZla2l0VXJsOiBzZXNzaW9uLmxpdmVraXRVcmwsXG4gICAgICBsaXZla2l0VG9rZW46IHNlc3Npb24ubGl2ZWtpdFRva2VuLFxuICAgIH0pO1xuICAgIHNlc3Npb24uY2FwdHVyaW5nID0gdHJ1ZTtcbiAgICBhd2FpdCBwZXJzaXN0U2Vzc2lvbihzZXNzaW9uKTtcbiAgICByZXR1cm4geyBvazogdHJ1ZSB9O1xuICB9IGNhdGNoIChlOiBhbnkpIHtcbiAgICBjb25zb2xlLmVycm9yKCdbYXV0aGxvb3BdIGNhcHR1cmUgZmFpbGVkOicsIGUpO1xuICAgIHJldHVybiB7IG9rOiBmYWxzZSwgZXJyb3I6IGUubWVzc2FnZSB9O1xuICB9XG59XG5cbi8vIOKUgOKUgOKUgCBUYWIgbWFuYWdlbWVudCDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcblxuYXN5bmMgZnVuY3Rpb24gZmluZE9yT3BlblRhYih1cmxIaW50Pzogc3RyaW5nKTogUHJvbWlzZTxudW1iZXIgfCBudWxsPiB7XG4gIGlmICh1cmxIaW50KSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGhvc3RuYW1lID0gbmV3IFVSTCh1cmxIaW50KS5ob3N0bmFtZTtcbiAgICAgIGNvbnNvbGUubG9nKCdbYXV0aGxvb3BdIHNlYXJjaGluZyB0YWJzIGZvciBob3N0bmFtZTonLCBob3N0bmFtZSk7XG4gICAgICBjb25zdCB0YWJzID0gYXdhaXQgY2hyb21lLnRhYnMucXVlcnkoeyB1cmw6IGAqOi8vJHtob3N0bmFtZX0vKmAgfSk7XG4gICAgICBjb25zb2xlLmxvZygnW2F1dGhsb29wXSBtYXRjaGluZyB0YWJzIGZvdW5kOicsIHRhYnMubGVuZ3RoKTtcbiAgICAgIGlmICh0YWJzWzBdPy5pZCkge1xuICAgICAgICBjb25zb2xlLmxvZygnW2F1dGhsb29wXSBmb2N1c2luZyBleGlzdGluZyB0YWI6JywgdGFic1swXS5pZCwgdGFic1swXS51cmwpO1xuICAgICAgICBjaHJvbWUudGFicy51cGRhdGUodGFic1swXS5pZCwgeyBhY3RpdmU6IHRydWUgfSk7XG4gICAgICAgIGlmICh0YWJzWzBdLndpbmRvd0lkKSBjaHJvbWUud2luZG93cy51cGRhdGUodGFic1swXS53aW5kb3dJZCwgeyBmb2N1c2VkOiB0cnVlIH0pO1xuICAgICAgICBhd2FpdCB3YWl0Rm9yVGFiTG9hZGVkKHRhYnNbMF0uaWQpO1xuICAgICAgICByZXR1cm4gdGFic1swXS5pZDtcbiAgICAgIH1cbiAgICAgIGNvbnNvbGUubG9nKCdbYXV0aGxvb3BdIG5vIG1hdGNoaW5nIHRhYiwgb3BlbmluZyBuZXcgdGFiOicsIHVybEhpbnQpO1xuICAgICAgY29uc3QgbmV3VGFiID0gYXdhaXQgY2hyb21lLnRhYnMuY3JlYXRlKHsgdXJsOiB1cmxIaW50LCBhY3RpdmU6IHRydWUgfSk7XG4gICAgICBjb25zb2xlLmxvZygnW2F1dGhsb29wXSBuZXcgdGFiIGNyZWF0ZWQ6JywgbmV3VGFiLmlkLCAnc3RhdHVzOicsIG5ld1RhYi5zdGF0dXMpO1xuICAgICAgaWYgKG5ld1RhYi5pZCkge1xuICAgICAgICBhd2FpdCB3YWl0Rm9yVGFiTG9hZGVkKG5ld1RhYi5pZCk7XG4gICAgICAgIGNvbnNvbGUubG9nKCdbYXV0aGxvb3BdIG5ldyB0YWIgbG9hZGVkJyk7XG4gICAgICAgIHJldHVybiBuZXdUYWIuaWQ7XG4gICAgICB9XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdbYXV0aGxvb3BdIGZpbmRPck9wZW5UYWIgZXJyb3I6JywgZSk7XG4gICAgfVxuICB9XG4gIGNvbnNvbGUubG9nKCdbYXV0aGxvb3BdIG5vIFVSTCBoaW50LCB1c2luZyBhY3RpdmUgdGFiJyk7XG4gIGNvbnN0IFthY3RpdmVUYWJdID0gYXdhaXQgY2hyb21lLnRhYnMucXVlcnkoeyBhY3RpdmU6IHRydWUsIGN1cnJlbnRXaW5kb3c6IHRydWUgfSk7XG4gIGNvbnNvbGUubG9nKCdbYXV0aGxvb3BdIGFjdGl2ZSB0YWI6JywgYWN0aXZlVGFiPy5pZCwgYWN0aXZlVGFiPy51cmwpO1xuICByZXR1cm4gYWN0aXZlVGFiPy5pZCA/PyBudWxsO1xufVxuXG5mdW5jdGlvbiB3YWl0Rm9yVGFiTG9hZGVkKHRhYklkOiBudW1iZXIpOiBQcm9taXNlPHZvaWQ+IHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgLy8gQ2hlY2sgaWYgYWxyZWFkeSBsb2FkZWRcbiAgICBjaHJvbWUudGFicy5nZXQodGFiSWQsICh0YWIpID0+IHtcbiAgICAgIGlmICh0YWIuc3RhdHVzID09PSAnY29tcGxldGUnKSB7IHJlc29sdmUoKTsgcmV0dXJuOyB9XG5cbiAgICAgIC8vIFdhaXQgZm9yIHRoZSB0YWIgdG8gZmluaXNoIGxvYWRpbmdcbiAgICAgIGNvbnN0IGxpc3RlbmVyID0gKHVwZGF0ZWRUYWJJZDogbnVtYmVyLCBjaGFuZ2VJbmZvOiBjaHJvbWUudGFicy5UYWJDaGFuZ2VJbmZvKSA9PiB7XG4gICAgICAgIGlmICh1cGRhdGVkVGFiSWQgPT09IHRhYklkICYmIGNoYW5nZUluZm8uc3RhdHVzID09PSAnY29tcGxldGUnKSB7XG4gICAgICAgICAgY2hyb21lLnRhYnMub25VcGRhdGVkLnJlbW92ZUxpc3RlbmVyKGxpc3RlbmVyKTtcbiAgICAgICAgICByZXNvbHZlKCk7XG4gICAgICAgIH1cbiAgICAgIH07XG4gICAgICBjaHJvbWUudGFicy5vblVwZGF0ZWQuYWRkTGlzdGVuZXIobGlzdGVuZXIpO1xuXG4gICAgICAvLyBTYWZldHkgdGltZW91dCDigJQgZG9uJ3Qgd2FpdCBmb3JldmVyXG4gICAgICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgY2hyb21lLnRhYnMub25VcGRhdGVkLnJlbW92ZUxpc3RlbmVyKGxpc3RlbmVyKTtcbiAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgfSwgMTUwMDApO1xuICAgIH0pO1xuICB9KTtcbn1cblxuLy8g4pSA4pSA4pSAIExpdmVLaXQgY2FwdHVyZSDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcblxuYXN5bmMgZnVuY3Rpb24gZW5zdXJlT2Zmc2NyZWVuKCk6IFByb21pc2U8dm9pZD4ge1xuICBpZiAob2Zmc2NyZWVuUG9ydCkgcmV0dXJuO1xuICBpZiAob2Zmc2NyZWVuQ3JlYXRpbmcpIHJldHVybiBvZmZzY3JlZW5DcmVhdGluZztcblxuICBvZmZzY3JlZW5DcmVhdGluZyA9IChhc3luYyAoKSA9PiB7XG4gICAgY29uc3QgY29udGV4dHMgPSBhd2FpdCAoY2hyb21lLnJ1bnRpbWUgYXMgYW55KS5nZXRDb250ZXh0cyh7XG4gICAgICBjb250ZXh0VHlwZXM6IFsnT0ZGU0NSRUVOX0RPQ1VNRU5UJ10sXG4gICAgfSk7XG4gICAgaWYgKGNvbnRleHRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgYXdhaXQgKGNocm9tZS5vZmZzY3JlZW4gYXMgYW55KS5jcmVhdGVEb2N1bWVudCh7XG4gICAgICAgIHVybDogY2hyb21lLnJ1bnRpbWUuZ2V0VVJMKCdvZmZzY3JlZW4uaHRtbCcpLFxuICAgICAgICByZWFzb25zOiBbJ1VTRVJfTUVESUEnXSxcbiAgICAgICAganVzdGlmaWNhdGlvbjogJ0xpdmVLaXQgV2ViUlRDIHZpYSB0YWJDYXB0dXJlIGZvciBhdXRoIHNlc3Npb24gc3RyZWFtaW5nJyxcbiAgICAgIH0pO1xuICAgIH1cbiAgICAvLyBXYWl0IGZvciBwb3J0XG4gICAgYXdhaXQgbmV3IFByb21pc2U8dm9pZD4ocmVzb2x2ZSA9PiB7XG4gICAgICBjb25zdCBjaGVjayA9IHNldEludGVydmFsKCgpID0+IHtcbiAgICAgICAgaWYgKG9mZnNjcmVlblBvcnQpIHsgY2xlYXJJbnRlcnZhbChjaGVjayk7IHJlc29sdmUoKTsgfVxuICAgICAgfSwgNTApO1xuICAgIH0pO1xuICB9KSgpO1xuXG4gIGF3YWl0IG9mZnNjcmVlbkNyZWF0aW5nO1xuICBvZmZzY3JlZW5DcmVhdGluZyA9IG51bGw7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHN0YXJ0TGl2ZUtpdENhcHR1cmUoXG4gIHRhYklkOiBudW1iZXIsXG4gIHN0cmVhbUlkOiBzdHJpbmcsXG4gIG9wdHM6IHsgc2Vzc2lvbklkOiBzdHJpbmc7IGxpdmVraXRVcmw6IHN0cmluZzsgbGl2ZWtpdFRva2VuOiBzdHJpbmcgfSxcbikge1xuICAvLyBHZXQgdGFiIGRpbWVuc2lvbnMgKyBEUFJcbiAgY29uc3QgdGFiID0gYXdhaXQgY2hyb21lLnRhYnMuZ2V0KHRhYklkKTtcbiAgY29uc29sZS5sb2coJ1thdXRobG9vcF0gdGFiIGluZm8g4oCUIHVybDonLCB0YWIudXJsLCAnc3RhdHVzOicsIHRhYi5zdGF0dXMsICdzaXplOicsIHRhYi53aWR0aCwgJ3gnLCB0YWIuaGVpZ2h0KTtcblxuICBsZXQgZHByID0gMTtcbiAgdHJ5IHtcbiAgICBjb25zdCBbeyByZXN1bHQgfV0gPSBhd2FpdCAoY2hyb21lLnNjcmlwdGluZyBhcyBhbnkpLmV4ZWN1dGVTY3JpcHQoe1xuICAgICAgdGFyZ2V0OiB7IHRhYklkIH0sXG4gICAgICBmdW5jOiAoKSA9PiB3aW5kb3cuZGV2aWNlUGl4ZWxSYXRpbyA/PyAxLFxuICAgIH0pO1xuICAgIGRwciA9IHJlc3VsdCBhcyBudW1iZXI7XG4gICAgY29uc29sZS5sb2coJ1thdXRobG9vcF0gRFBSOicsIGRwcik7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLndhcm4oJ1thdXRobG9vcF0gZmFpbGVkIHRvIGdldCBEUFI6JywgZSk7XG4gIH1cblxuICBjb25zb2xlLmxvZygnW2F1dGhsb29wXSBzdHJlYW0gSUQgZnJvbSBwb3B1cDonLCBzdHJlYW1JZC5zbGljZSgwLCAyMCkgKyAnLi4uJyk7XG5cbiAgLy8gRW5zdXJlIG9mZnNjcmVlbiBkb2N1bWVudFxuICBjb25zb2xlLmxvZygnW2F1dGhsb29wXSBlbnN1cmluZyBvZmZzY3JlZW4gZG9jdW1lbnQuLi4nKTtcbiAgYXdhaXQgZW5zdXJlT2Zmc2NyZWVuKCk7XG4gIGNvbnNvbGUubG9nKCdbYXV0aGxvb3BdIG9mZnNjcmVlbiBkb2N1bWVudCByZWFkeSwgc2VuZGluZyBTVEFSVF9MSVZFS0lUJyk7XG5cbiAgLy8gVGVsbCBvZmZzY3JlZW4gdG8gc3RhcnQgTGl2ZUtpdFxuICBvZmZzY3JlZW5Qb3J0Py5wb3N0TWVzc2FnZSh7XG4gICAgdHlwZTogJ1NUQVJUX0xJVkVLSVQnLFxuICAgIHN0cmVhbUlkLFxuICAgIHNlc3Npb25JZDogb3B0cy5zZXNzaW9uSWQsXG4gICAgbGl2ZWtpdFVybDogb3B0cy5saXZla2l0VXJsLFxuICAgIGxpdmVraXRUb2tlbjogb3B0cy5saXZla2l0VG9rZW4sXG4gICAgY3NzV2lkdGg6IHRhYi53aWR0aCA/PyAxMjgwLFxuICAgIGNzc0hlaWdodDogdGFiLmhlaWdodCA/PyA3MjAsXG4gICAgcGl4ZWxSYXRpbzogZHByLFxuICB9KTtcbn1cblxuLy8g4pSA4pSA4pSAIElucHV0IGRpc3BhdGNoIHZpYSBjaHJvbWUuZGVidWdnZXIg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5cbmFzeW5jIGZ1bmN0aW9uIGVuc3VyZURlYnVnZ2VyKHRhYklkOiBudW1iZXIpIHtcbiAgaWYgKGRiZy5hdHRhY2hlZCAmJiBkYmcudGFiSWQgPT09IHRhYklkKSByZXR1cm47XG4gIGlmIChkYmcuYXR0YWNoZWQpIHtcbiAgICB0cnkgeyBhd2FpdCBjaHJvbWUuZGVidWdnZXIuZGV0YWNoKHsgdGFiSWQ6IGRiZy50YWJJZCB9KTsgfSBjYXRjaCB7fVxuICB9XG4gIGF3YWl0IGNocm9tZS5kZWJ1Z2dlci5hdHRhY2goeyB0YWJJZCB9LCAnMS4zJyk7XG4gIE9iamVjdC5hc3NpZ24oZGJnLCB7IGF0dGFjaGVkOiB0cnVlLCB0YWJJZCB9KTtcbn1cblxuZnVuY3Rpb24gc2NoZWR1bGVEZXRhY2godGFiSWQ6IG51bWJlciwgbXMgPSAzMDAwKSB7XG4gIGNsZWFyVGltZW91dChkYmcuZGV0YWNoVGltZXIpO1xuICBkYmcuZGV0YWNoVGltZXIgPSBzZXRUaW1lb3V0KGFzeW5jICgpID0+IHtcbiAgICBpZiAoIWRiZy5hdHRhY2hlZCB8fCBkYmcudGFiSWQgIT09IHRhYklkKSByZXR1cm47XG4gICAgdHJ5IHsgYXdhaXQgY2hyb21lLmRlYnVnZ2VyLmRldGFjaCh7IHRhYklkIH0pOyB9IGNhdGNoIHt9XG4gICAgT2JqZWN0LmFzc2lnbihkYmcsIHsgYXR0YWNoZWQ6IGZhbHNlLCB0YWJJZDogMCB9KTtcbiAgfSwgbXMpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBoYW5kbGVJbnB1dEV2ZW50KG1zZzogYW55KSB7XG4gIGNvbnN0IHNlc3Npb24gPSBhd2FpdCBnZXRQZXJzaXN0ZWRTZXNzaW9uKCk7XG4gIGlmICghc2Vzc2lvbj8udGFiSWQpIHJldHVybjtcbiAgY29uc3QgdGFiSWQgPSBzZXNzaW9uLnRhYklkO1xuXG4gIHRyeSB7XG4gICAgc3dpdGNoIChtc2cudHlwZSkge1xuICAgICAgY2FzZSAnY2xpY2snOiB7XG4gICAgICAgIGlmICghTnVtYmVyLmlzRmluaXRlKG1zZy54KSB8fCAhTnVtYmVyLmlzRmluaXRlKG1zZy55KSkgcmV0dXJuO1xuICAgICAgICBhd2FpdCBlbnN1cmVEZWJ1Z2dlcih0YWJJZCk7XG4gICAgICAgIGF3YWl0IGNocm9tZS5kZWJ1Z2dlci5zZW5kQ29tbWFuZCh7IHRhYklkIH0sICdJbnB1dC5kaXNwYXRjaE1vdXNlRXZlbnQnLFxuICAgICAgICAgIHsgdHlwZTogJ21vdXNlUHJlc3NlZCcsIHg6IG1zZy54LCB5OiBtc2cueSwgYnV0dG9uOiAnbGVmdCcsIGNsaWNrQ291bnQ6IDEsIG1vZGlmaWVyczogMCB9KTtcbiAgICAgICAgYXdhaXQgY2hyb21lLmRlYnVnZ2VyLnNlbmRDb21tYW5kKHsgdGFiSWQgfSwgJ0lucHV0LmRpc3BhdGNoTW91c2VFdmVudCcsXG4gICAgICAgICAgeyB0eXBlOiAnbW91c2VSZWxlYXNlZCcsIHg6IG1zZy54LCB5OiBtc2cueSwgYnV0dG9uOiAnbGVmdCcsIGNsaWNrQ291bnQ6IDEsIG1vZGlmaWVyczogMCB9KTtcbiAgICAgICAgc2NoZWR1bGVEZXRhY2godGFiSWQpO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIGNhc2UgJ2tleWRvd24nOiB7XG4gICAgICAgIGF3YWl0IGVuc3VyZURlYnVnZ2VyKHRhYklkKTtcbiAgICAgICAgYXdhaXQgY2hyb21lLmRlYnVnZ2VyLnNlbmRDb21tYW5kKHsgdGFiSWQgfSwgJ0lucHV0LmRpc3BhdGNoS2V5RXZlbnQnLCB7XG4gICAgICAgICAgdHlwZTogJ3Jhd0tleURvd24nLCBrZXk6IG1zZy5rZXksIGNvZGU6IG1zZy5jb2RlLFxuICAgICAgICAgIHRleHQ6IG1zZy5rZXk/Lmxlbmd0aCA9PT0gMSA/IG1zZy5rZXkgOiB1bmRlZmluZWQsXG4gICAgICAgICAgbW9kaWZpZXJzOiBtc2cubW9kaWZpZXJzID8/IDAsXG4gICAgICAgICAgd2luZG93c1ZpcnR1YWxLZXlDb2RlOiBtc2cua2V5Q29kZSA/PyAwLFxuICAgICAgICB9KTtcbiAgICAgICAgc2NoZWR1bGVEZXRhY2godGFiSWQpO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIGNhc2UgJ2tleXVwJzoge1xuICAgICAgICBhd2FpdCBlbnN1cmVEZWJ1Z2dlcih0YWJJZCk7XG4gICAgICAgIGF3YWl0IGNocm9tZS5kZWJ1Z2dlci5zZW5kQ29tbWFuZCh7IHRhYklkIH0sICdJbnB1dC5kaXNwYXRjaEtleUV2ZW50Jywge1xuICAgICAgICAgIHR5cGU6ICdrZXlVcCcsIGtleTogbXNnLmtleSwgY29kZTogbXNnLmNvZGUsXG4gICAgICAgICAgbW9kaWZpZXJzOiBtc2cubW9kaWZpZXJzID8/IDAsXG4gICAgICAgICAgd2luZG93c1ZpcnR1YWxLZXlDb2RlOiBtc2cua2V5Q29kZSA/PyAwLFxuICAgICAgICB9KTtcbiAgICAgICAgc2NoZWR1bGVEZXRhY2godGFiSWQpO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIGNhc2UgJ2tleXByZXNzJzoge1xuICAgICAgICBpZiAoIW1zZy5rZXkgfHwgbXNnLmtleS5sZW5ndGggIT09IDEpIHJldHVybjtcbiAgICAgICAgYXdhaXQgZW5zdXJlRGVidWdnZXIodGFiSWQpO1xuICAgICAgICBhd2FpdCBjaHJvbWUuZGVidWdnZXIuc2VuZENvbW1hbmQoeyB0YWJJZCB9LCAnSW5wdXQuZGlzcGF0Y2hLZXlFdmVudCcsIHtcbiAgICAgICAgICB0eXBlOiAnY2hhcicsIHRleHQ6IG1zZy5rZXksIG1vZGlmaWVyczogbXNnLm1vZGlmaWVycyA/PyAwLFxuICAgICAgICB9KTtcbiAgICAgICAgc2NoZWR1bGVEZXRhY2godGFiSWQpO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIGNhc2UgJ3Njcm9sbCc6IHtcbiAgICAgICAgaWYgKCFOdW1iZXIuaXNGaW5pdGUobXNnLngpIHx8ICFOdW1iZXIuaXNGaW5pdGUobXNnLnkpKSByZXR1cm47XG4gICAgICAgIGF3YWl0IGVuc3VyZURlYnVnZ2VyKHRhYklkKTtcbiAgICAgICAgYXdhaXQgY2hyb21lLmRlYnVnZ2VyLnNlbmRDb21tYW5kKHsgdGFiSWQgfSwgJ0lucHV0LmRpc3BhdGNoTW91c2VFdmVudCcsIHtcbiAgICAgICAgICB0eXBlOiAnbW91c2VXaGVlbCcsIHg6IG1zZy54LCB5OiBtc2cueSxcbiAgICAgICAgICBkZWx0YVg6IG1zZy5kZWx0YVggPz8gMCwgZGVsdGFZOiBtc2cuZGVsdGFZID8/IDAsXG4gICAgICAgIH0pO1xuICAgICAgICBzY2hlZHVsZURldGFjaCh0YWJJZCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgY2FzZSAncGFzdGUnOiB7XG4gICAgICAgIGlmICh0eXBlb2YgbXNnLnRleHQgIT09ICdzdHJpbmcnIHx8IG1zZy50ZXh0Lmxlbmd0aCA+IDEwXzAwMCkgcmV0dXJuO1xuICAgICAgICBhd2FpdCBlbnN1cmVEZWJ1Z2dlcih0YWJJZCk7XG4gICAgICAgIGF3YWl0IGNocm9tZS5kZWJ1Z2dlci5zZW5kQ29tbWFuZCh7IHRhYklkIH0sICdJbnB1dC5pbnNlcnRUZXh0JywgeyB0ZXh0OiBtc2cudGV4dCB9KTtcbiAgICAgICAgc2NoZWR1bGVEZXRhY2godGFiSWQpO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIGNhc2UgJ3Jlc29sdmVkJzoge1xuICAgICAgICBhd2FpdCByZXNvbHZlQWN0aXZlU2Vzc2lvbigpO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIGNhc2UgJ2NhbmNlbGxlZCc6IHtcbiAgICAgICAgd3M/LnNlbmQoSlNPTi5zdHJpbmdpZnkoeyB0eXBlOiAnc2Vzc2lvbl9lcnJvcicsIHNlc3Npb25faWQ6IHNlc3Npb24uc2Vzc2lvbklkLCBlcnJvcjogJ2NhbmNlbGxlZCcgfSkpO1xuICAgICAgICBhd2FpdCBjbGVhclNlc3Npb24oKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcignW2F1dGhsb29wXSBpbnB1dCBkaXNwYXRjaCBlcnJvcjonLCBlKTtcbiAgfVxufVxuXG4vLyDilIDilIDilIAgVG9rZW4gbWFuYWdlbWVudCDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcblxuYXN5bmMgZnVuY3Rpb24gcmVmcmVzaEFjY2Vzc1Rva2VuKCkge1xuICBjb25zdCB7IHJlZnJlc2hUb2tlbiwgZGV2aWNlSWQgfSA9IGF3YWl0IGNocm9tZS5zdG9yYWdlLmxvY2FsLmdldChbJ3JlZnJlc2hUb2tlbicsICdkZXZpY2VJZCddKTtcbiAgaWYgKCFyZWZyZXNoVG9rZW4gfHwgIWRldmljZUlkKSByZXR1cm47XG4gIGNvbnN0IGFwaUJhc2UgPSBhd2FpdCBnZXRBcGlCYXNlKCk7XG5cbiAgdHJ5IHtcbiAgICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaChgJHthcGlCYXNlfS9leHRlbnNpb24vcmVmcmVzaGAsIHtcbiAgICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgICAgaGVhZGVyczogeyAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nIH0sXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IHJlZnJlc2hfdG9rZW46IHJlZnJlc2hUb2tlbiwgZGV2aWNlX2lkOiBkZXZpY2VJZCB9KSxcbiAgICB9KTtcblxuICAgIGlmICghcmVzLm9rKSB7XG4gICAgICBpZiAocmVzLnN0YXR1cyA9PT0gNDAxKSB7XG4gICAgICAgIGF3YWl0IGNocm9tZS5zdG9yYWdlLmxvY2FsLnJlbW92ZShbJ2FjY2Vzc1Rva2VuJywgJ3JlZnJlc2hUb2tlbicsICdkZXZpY2VJZCcsICd1c2VySWQnXSk7XG4gICAgICAgIHdzPy5jbG9zZSgpO1xuICAgICAgfVxuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGRhdGEgPSAoYXdhaXQgcmVzLmpzb24oKSkgYXMgeyBhY2Nlc3NfdG9rZW46IHN0cmluZyB9O1xuICAgIGF3YWl0IGNocm9tZS5zdG9yYWdlLmxvY2FsLnNldCh7IGFjY2Vzc1Rva2VuOiBkYXRhLmFjY2Vzc190b2tlbiB9KTtcbiAgICBjb25uZWN0KCk7XG4gIH0gY2F0Y2gge31cbn1cblxuLy8g4pSA4pSA4pSAIFN0YXRlIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuXG5hc3luYyBmdW5jdGlvbiBnZXRTdGF0ZSgpIHtcbiAgY29uc3QgeyBhY2Nlc3NUb2tlbiwgZGV2aWNlSWQsIHVzZXJJZCB9ID0gYXdhaXQgY2hyb21lLnN0b3JhZ2UubG9jYWwuZ2V0KFsnYWNjZXNzVG9rZW4nLCAnZGV2aWNlSWQnLCAndXNlcklkJ10pO1xuICBjb25zdCBzZXNzaW9uID0gYXdhaXQgZ2V0UGVyc2lzdGVkU2Vzc2lvbigpO1xuICByZXR1cm4ge1xuICAgIHBhaXJlZDogISEoYWNjZXNzVG9rZW4gJiYgZGV2aWNlSWQpLFxuICAgIGNvbm5lY3RlZDogd3M/LnJlYWR5U3RhdGUgPT09IFdlYlNvY2tldC5PUEVOLFxuICAgIHVzZXJJZCxcbiAgICBhY3RpdmVTZXNzaW9uOiBzZXNzaW9uLFxuICB9O1xufVxuXG4vLyDilIDilIDilIAgSW5pdCDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQmFja2dyb3VuZChhc3luYyAoKSA9PiB7XG4gIC8vIFJlZ2lzdGVyIGxpc3RlbmVycyB0aGF0IFdYVCdzIGZha2UtYnJvd3NlciBkb2Vzbid0IG1vY2sgKG9uQ29ubmVjdCwgZGVidWdnZXIub25EZXRhY2gpLlxuICAvLyBUaGVzZSBzdGlsbCBydW4gYXQgU1cgc3RhcnR1cCwgd2hpY2ggaXMgZWFybHkgZW5vdWdoIGZvciBNVjMuXG5cbiAgY2hyb21lLnJ1bnRpbWUub25Db25uZWN0LmFkZExpc3RlbmVyKChwb3J0KSA9PiB7XG4gICAgaWYgKHBvcnQubmFtZSAhPT0gJ2F1dGhsb29wLW9mZnNjcmVlbicpIHJldHVybjtcbiAgICBvZmZzY3JlZW5Qb3J0ID0gcG9ydDtcblxuICAgIHBvcnQub25NZXNzYWdlLmFkZExpc3RlbmVyKChtc2cpID0+IHtcbiAgICAgIGlmIChtc2cudHlwZSA9PT0gJ0hFQVJUQkVBVCcpIHJldHVybjtcbiAgICAgIGlmIChtc2cudHlwZSA9PT0gJ1RSQUNLX0VOREVEJykgaGFuZGxlVHJhY2tFbmRlZChtc2cuc2Vzc2lvbklkKTtcbiAgICAgIGlmIChtc2cudHlwZSA9PT0gJ0xJVkVLSVRfQ09OTkVDVEVEJykgY29uc29sZS5sb2coJ1thdXRobG9vcF0gTGl2ZUtpdCBzdHJlYW1pbmcgZm9yJywgbXNnLnNlc3Npb25JZCk7XG4gICAgICBpZiAobXNnLnR5cGUgPT09ICdMSVZFS0lUX0VSUk9SJykgY29uc29sZS5lcnJvcignW2F1dGhsb29wXSBMaXZlS2l0IGVycm9yOicsIG1zZy5lcnJvcik7XG4gICAgICAvLyBJbnB1dCBldmVudHMgZm9yd2FyZGVkIGZyb20gb2Zmc2NyZWVuIChvcmlnaW5hbGx5IGZyb20gTGl2ZUtpdCBkYXRhIGNoYW5uZWwpXG4gICAgICBpZiAoWydjbGljaycsICdkYmxjbGljaycsICdrZXlkb3duJywgJ2tleXVwJywgJ2tleXByZXNzJywgJ3Njcm9sbCcsICdwYXN0ZScsICdyZXNvbHZlZCcsICdjYW5jZWxsZWQnXS5pbmNsdWRlcyhtc2cudHlwZSkpIHtcbiAgICAgICAgaGFuZGxlSW5wdXRFdmVudChtc2cpO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgcG9ydC5vbkRpc2Nvbm5lY3QuYWRkTGlzdGVuZXIoKCkgPT4ge1xuICAgICAgb2Zmc2NyZWVuUG9ydCA9IG51bGw7XG4gICAgICBvZmZzY3JlZW5DcmVhdGluZyA9IG51bGw7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGNocm9tZS5kZWJ1Z2dlci5vbkRldGFjaC5hZGRMaXN0ZW5lcigoc291cmNlLCByZWFzb24pID0+IHtcbiAgICBpZiAoc291cmNlLnRhYklkID09PSBkYmcudGFiSWQpIHtcbiAgICAgIGNvbnNvbGUud2FybignW2F1dGhsb29wXSBkZWJ1Z2dlciBkZXRhY2hlZDonLCByZWFzb24pO1xuICAgICAgY2xlYXJUaW1lb3V0KGRiZy5kZXRhY2hUaW1lcik7XG4gICAgICBPYmplY3QuYXNzaWduKGRiZywgeyBhdHRhY2hlZDogZmFsc2UsIHRhYklkOiAwIH0pO1xuICAgIH1cbiAgfSk7XG5cbiAgLy8gUmVzdG9yZSBzZXNzaW9uIHN0YXRlXG4gIGNvbnN0IHNlc3Npb24gPSBhd2FpdCBnZXRQZXJzaXN0ZWRTZXNzaW9uKCk7XG4gIGlmIChzZXNzaW9uKSB7XG4gICAgY2hyb21lLmFjdGlvbi5zZXRCYWRnZVRleHQoeyB0ZXh0OiAnXFx1MjVDRicgfSk7XG4gICAgY2hyb21lLmFjdGlvbi5zZXRCYWRnZUJhY2tncm91bmRDb2xvcih7IGNvbG9yOiAnI2VmNDQ0NCcgfSk7XG4gICAgY2hyb21lLmFsYXJtcy5jcmVhdGUoJ2tlZXBhbGl2ZScsIHsgcGVyaW9kSW5NaW51dGVzOiAyNSAvIDYwIH0pO1xuICB9XG4gIGNvbm5lY3QoKTtcbn0pO1xuIiwiLy8gI3JlZ2lvbiBzbmlwcGV0XG5leHBvcnQgY29uc3QgYnJvd3NlciA9IGdsb2JhbFRoaXMuYnJvd3Nlcj8ucnVudGltZT8uaWRcbiAgPyBnbG9iYWxUaGlzLmJyb3dzZXJcbiAgOiBnbG9iYWxUaGlzLmNocm9tZTtcbi8vICNlbmRyZWdpb24gc25pcHBldFxuIiwiaW1wb3J0IHsgYnJvd3NlciBhcyBicm93c2VyJDEgfSBmcm9tIFwiQHd4dC1kZXYvYnJvd3NlclwiO1xuLy8jcmVnaW9uIHNyYy9icm93c2VyLnRzXG4vKipcbiogQ29udGFpbnMgdGhlIGBicm93c2VyYCBleHBvcnQgd2hpY2ggeW91IHNob3VsZCB1c2UgdG8gYWNjZXNzIHRoZSBleHRlbnNpb25cbiogQVBJcyBpbiB5b3VyIHByb2plY3Q6XG4qXG4qIGBgYHRzXG4qIGltcG9ydCB7IGJyb3dzZXIgfSBmcm9tICd3eHQvYnJvd3Nlcic7XG4qXG4qIGJyb3dzZXIucnVudGltZS5vbkluc3RhbGxlZC5hZGRMaXN0ZW5lcigoKSA9PiB7XG4qICAgLy8gLi4uXG4qIH0pO1xuKiBgYGBcbipcbiogQG1vZHVsZSB3eHQvYnJvd3NlclxuKi9cbmNvbnN0IGJyb3dzZXIgPSBicm93c2VyJDE7XG4vLyNlbmRyZWdpb25cbmV4cG9ydCB7IGJyb3dzZXIgfTtcbiIsIi8vIHNyYy9pbmRleC50c1xudmFyIF9NYXRjaFBhdHRlcm4gPSBjbGFzcyB7XG4gIGNvbnN0cnVjdG9yKG1hdGNoUGF0dGVybikge1xuICAgIGlmIChtYXRjaFBhdHRlcm4gPT09IFwiPGFsbF91cmxzPlwiKSB7XG4gICAgICB0aGlzLmlzQWxsVXJscyA9IHRydWU7XG4gICAgICB0aGlzLnByb3RvY29sTWF0Y2hlcyA9IFsuLi5fTWF0Y2hQYXR0ZXJuLlBST1RPQ09MU107XG4gICAgICB0aGlzLmhvc3RuYW1lTWF0Y2ggPSBcIipcIjtcbiAgICAgIHRoaXMucGF0aG5hbWVNYXRjaCA9IFwiKlwiO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBncm91cHMgPSAvKC4qKTpcXC9cXC8oLio/KShcXC8uKikvLmV4ZWMobWF0Y2hQYXR0ZXJuKTtcbiAgICAgIGlmIChncm91cHMgPT0gbnVsbClcbiAgICAgICAgdGhyb3cgbmV3IEludmFsaWRNYXRjaFBhdHRlcm4obWF0Y2hQYXR0ZXJuLCBcIkluY29ycmVjdCBmb3JtYXRcIik7XG4gICAgICBjb25zdCBbXywgcHJvdG9jb2wsIGhvc3RuYW1lLCBwYXRobmFtZV0gPSBncm91cHM7XG4gICAgICB2YWxpZGF0ZVByb3RvY29sKG1hdGNoUGF0dGVybiwgcHJvdG9jb2wpO1xuICAgICAgdmFsaWRhdGVIb3N0bmFtZShtYXRjaFBhdHRlcm4sIGhvc3RuYW1lKTtcbiAgICAgIHZhbGlkYXRlUGF0aG5hbWUobWF0Y2hQYXR0ZXJuLCBwYXRobmFtZSk7XG4gICAgICB0aGlzLnByb3RvY29sTWF0Y2hlcyA9IHByb3RvY29sID09PSBcIipcIiA/IFtcImh0dHBcIiwgXCJodHRwc1wiXSA6IFtwcm90b2NvbF07XG4gICAgICB0aGlzLmhvc3RuYW1lTWF0Y2ggPSBob3N0bmFtZTtcbiAgICAgIHRoaXMucGF0aG5hbWVNYXRjaCA9IHBhdGhuYW1lO1xuICAgIH1cbiAgfVxuICBpbmNsdWRlcyh1cmwpIHtcbiAgICBpZiAodGhpcy5pc0FsbFVybHMpXG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICBjb25zdCB1ID0gdHlwZW9mIHVybCA9PT0gXCJzdHJpbmdcIiA/IG5ldyBVUkwodXJsKSA6IHVybCBpbnN0YW5jZW9mIExvY2F0aW9uID8gbmV3IFVSTCh1cmwuaHJlZikgOiB1cmw7XG4gICAgcmV0dXJuICEhdGhpcy5wcm90b2NvbE1hdGNoZXMuZmluZCgocHJvdG9jb2wpID0+IHtcbiAgICAgIGlmIChwcm90b2NvbCA9PT0gXCJodHRwXCIpXG4gICAgICAgIHJldHVybiB0aGlzLmlzSHR0cE1hdGNoKHUpO1xuICAgICAgaWYgKHByb3RvY29sID09PSBcImh0dHBzXCIpXG4gICAgICAgIHJldHVybiB0aGlzLmlzSHR0cHNNYXRjaCh1KTtcbiAgICAgIGlmIChwcm90b2NvbCA9PT0gXCJmaWxlXCIpXG4gICAgICAgIHJldHVybiB0aGlzLmlzRmlsZU1hdGNoKHUpO1xuICAgICAgaWYgKHByb3RvY29sID09PSBcImZ0cFwiKVxuICAgICAgICByZXR1cm4gdGhpcy5pc0Z0cE1hdGNoKHUpO1xuICAgICAgaWYgKHByb3RvY29sID09PSBcInVyblwiKVxuICAgICAgICByZXR1cm4gdGhpcy5pc1Vybk1hdGNoKHUpO1xuICAgIH0pO1xuICB9XG4gIGlzSHR0cE1hdGNoKHVybCkge1xuICAgIHJldHVybiB1cmwucHJvdG9jb2wgPT09IFwiaHR0cDpcIiAmJiB0aGlzLmlzSG9zdFBhdGhNYXRjaCh1cmwpO1xuICB9XG4gIGlzSHR0cHNNYXRjaCh1cmwpIHtcbiAgICByZXR1cm4gdXJsLnByb3RvY29sID09PSBcImh0dHBzOlwiICYmIHRoaXMuaXNIb3N0UGF0aE1hdGNoKHVybCk7XG4gIH1cbiAgaXNIb3N0UGF0aE1hdGNoKHVybCkge1xuICAgIGlmICghdGhpcy5ob3N0bmFtZU1hdGNoIHx8ICF0aGlzLnBhdGhuYW1lTWF0Y2gpXG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgY29uc3QgaG9zdG5hbWVNYXRjaFJlZ2V4cyA9IFtcbiAgICAgIHRoaXMuY29udmVydFBhdHRlcm5Ub1JlZ2V4KHRoaXMuaG9zdG5hbWVNYXRjaCksXG4gICAgICB0aGlzLmNvbnZlcnRQYXR0ZXJuVG9SZWdleCh0aGlzLmhvc3RuYW1lTWF0Y2gucmVwbGFjZSgvXlxcKlxcLi8sIFwiXCIpKVxuICAgIF07XG4gICAgY29uc3QgcGF0aG5hbWVNYXRjaFJlZ2V4ID0gdGhpcy5jb252ZXJ0UGF0dGVyblRvUmVnZXgodGhpcy5wYXRobmFtZU1hdGNoKTtcbiAgICByZXR1cm4gISFob3N0bmFtZU1hdGNoUmVnZXhzLmZpbmQoKHJlZ2V4KSA9PiByZWdleC50ZXN0KHVybC5ob3N0bmFtZSkpICYmIHBhdGhuYW1lTWF0Y2hSZWdleC50ZXN0KHVybC5wYXRobmFtZSk7XG4gIH1cbiAgaXNGaWxlTWF0Y2godXJsKSB7XG4gICAgdGhyb3cgRXJyb3IoXCJOb3QgaW1wbGVtZW50ZWQ6IGZpbGU6Ly8gcGF0dGVybiBtYXRjaGluZy4gT3BlbiBhIFBSIHRvIGFkZCBzdXBwb3J0XCIpO1xuICB9XG4gIGlzRnRwTWF0Y2godXJsKSB7XG4gICAgdGhyb3cgRXJyb3IoXCJOb3QgaW1wbGVtZW50ZWQ6IGZ0cDovLyBwYXR0ZXJuIG1hdGNoaW5nLiBPcGVuIGEgUFIgdG8gYWRkIHN1cHBvcnRcIik7XG4gIH1cbiAgaXNVcm5NYXRjaCh1cmwpIHtcbiAgICB0aHJvdyBFcnJvcihcIk5vdCBpbXBsZW1lbnRlZDogdXJuOi8vIHBhdHRlcm4gbWF0Y2hpbmcuIE9wZW4gYSBQUiB0byBhZGQgc3VwcG9ydFwiKTtcbiAgfVxuICBjb252ZXJ0UGF0dGVyblRvUmVnZXgocGF0dGVybikge1xuICAgIGNvbnN0IGVzY2FwZWQgPSB0aGlzLmVzY2FwZUZvclJlZ2V4KHBhdHRlcm4pO1xuICAgIGNvbnN0IHN0YXJzUmVwbGFjZWQgPSBlc2NhcGVkLnJlcGxhY2UoL1xcXFxcXCovZywgXCIuKlwiKTtcbiAgICByZXR1cm4gUmVnRXhwKGBeJHtzdGFyc1JlcGxhY2VkfSRgKTtcbiAgfVxuICBlc2NhcGVGb3JSZWdleChzdHJpbmcpIHtcbiAgICByZXR1cm4gc3RyaW5nLnJlcGxhY2UoL1suKis/XiR7fSgpfFtcXF1cXFxcXS9nLCBcIlxcXFwkJlwiKTtcbiAgfVxufTtcbnZhciBNYXRjaFBhdHRlcm4gPSBfTWF0Y2hQYXR0ZXJuO1xuTWF0Y2hQYXR0ZXJuLlBST1RPQ09MUyA9IFtcImh0dHBcIiwgXCJodHRwc1wiLCBcImZpbGVcIiwgXCJmdHBcIiwgXCJ1cm5cIl07XG52YXIgSW52YWxpZE1hdGNoUGF0dGVybiA9IGNsYXNzIGV4dGVuZHMgRXJyb3Ige1xuICBjb25zdHJ1Y3RvcihtYXRjaFBhdHRlcm4sIHJlYXNvbikge1xuICAgIHN1cGVyKGBJbnZhbGlkIG1hdGNoIHBhdHRlcm4gXCIke21hdGNoUGF0dGVybn1cIjogJHtyZWFzb259YCk7XG4gIH1cbn07XG5mdW5jdGlvbiB2YWxpZGF0ZVByb3RvY29sKG1hdGNoUGF0dGVybiwgcHJvdG9jb2wpIHtcbiAgaWYgKCFNYXRjaFBhdHRlcm4uUFJPVE9DT0xTLmluY2x1ZGVzKHByb3RvY29sKSAmJiBwcm90b2NvbCAhPT0gXCIqXCIpXG4gICAgdGhyb3cgbmV3IEludmFsaWRNYXRjaFBhdHRlcm4oXG4gICAgICBtYXRjaFBhdHRlcm4sXG4gICAgICBgJHtwcm90b2NvbH0gbm90IGEgdmFsaWQgcHJvdG9jb2wgKCR7TWF0Y2hQYXR0ZXJuLlBST1RPQ09MUy5qb2luKFwiLCBcIil9KWBcbiAgICApO1xufVxuZnVuY3Rpb24gdmFsaWRhdGVIb3N0bmFtZShtYXRjaFBhdHRlcm4sIGhvc3RuYW1lKSB7XG4gIGlmIChob3N0bmFtZS5pbmNsdWRlcyhcIjpcIikpXG4gICAgdGhyb3cgbmV3IEludmFsaWRNYXRjaFBhdHRlcm4obWF0Y2hQYXR0ZXJuLCBgSG9zdG5hbWUgY2Fubm90IGluY2x1ZGUgYSBwb3J0YCk7XG4gIGlmIChob3N0bmFtZS5pbmNsdWRlcyhcIipcIikgJiYgaG9zdG5hbWUubGVuZ3RoID4gMSAmJiAhaG9zdG5hbWUuc3RhcnRzV2l0aChcIiouXCIpKVxuICAgIHRocm93IG5ldyBJbnZhbGlkTWF0Y2hQYXR0ZXJuKFxuICAgICAgbWF0Y2hQYXR0ZXJuLFxuICAgICAgYElmIHVzaW5nIGEgd2lsZGNhcmQgKCopLCBpdCBtdXN0IGdvIGF0IHRoZSBzdGFydCBvZiB0aGUgaG9zdG5hbWVgXG4gICAgKTtcbn1cbmZ1bmN0aW9uIHZhbGlkYXRlUGF0aG5hbWUobWF0Y2hQYXR0ZXJuLCBwYXRobmFtZSkge1xuICByZXR1cm47XG59XG5leHBvcnQge1xuICBJbnZhbGlkTWF0Y2hQYXR0ZXJuLFxuICBNYXRjaFBhdHRlcm5cbn07XG4iXSwieF9nb29nbGVfaWdub3JlTGlzdCI6WzAsMiwzLDRdLCJtYXBwaW5ncyI6Ijs7Q0FDQSxTQUFTLGlCQUFpQixLQUFLO0FBQzlCLE1BQUksT0FBTyxRQUFRLE9BQU8sUUFBUSxXQUFZLFFBQU8sRUFBRSxNQUFNLEtBQUs7QUFDbEUsU0FBTzs7OztDQ1NSLElBQUEsbUJBQUE7Q0FjQSxJQUFBLE9BQUE7Q0FDQSxJQUFBLG9CQUFBO0NBQ0EsSUFBQSxnQkFBQTtDQUNBLElBQUEsb0JBQUE7Q0FHQSxJQUFBLE1BQUE7Ozs7O0FBSUEsUUFBQSxRQUFBLFlBQUEsa0JBQUE7QUFDRSxTQUFBLE9BQUEsT0FBQSxpQkFBQSxFQUFBLGlCQUFBLElBQUEsQ0FBQTs7QUFHRixRQUFBLE9BQUEsUUFBQSxZQUFBLE9BQUEsVUFBQTtBQUNFLFVBQUEsTUFBQSxNQUFBOztBQUN3QixVQUFBLG9CQUFBO0FBQTRC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QUNFLE1BQUEsSUFBQSxZQUFBLElBQUEsVUFBQSxNQUFBO0FBQ0EsTUFBQSxJQUFBLFNBQ0UsS0FBQTtBQUFNLFNBQUEsT0FBQSxTQUFBLE9BQUEsRUFBQSxPQUFBLElBQUEsT0FBQSxDQUFBOztBQUVSLFFBQUEsT0FBQSxTQUFBLE9BQUEsRUFBQSxPQUFBLEVBQUEsTUFBQTtBQUNBLFNBQUEsT0FBQSxLQUFBOzs7OztDQUdGLFNBQUEsZUFBQSxPQUFBLEtBQUEsS0FBQTtBQUNFLGVBQUEsSUFBQSxZQUFBO0FBQ0EsTUFBQSxjQUFBLFdBQUEsWUFBQTtBQUNFLE9BQUEsQ0FBQSxJQUFBLFlBQUEsSUFBQSxVQUFBLE1BQUE7QUFDQSxPQUFBO0FBQU0sVUFBQSxPQUFBLFNBQUEsT0FBQSxFQUFBLE9BQUEsQ0FBQTs7QUFDTixVQUFBLE9BQUEsS0FBQTs7Ozs7O0NBSUosZUFBQSxpQkFBQSxLQUFBOztBQUVFLE1BQUEsQ0FBQSxTQUFBLE1BQUE7O0FBR0EsTUFBQTtBQUNFLFdBQUEsSUFBQSxNQUFBOztBQUVJLFNBQUEsQ0FBQSxPQUFBLFNBQUEsSUFBQSxFQUFBLElBQUEsQ0FBQSxPQUFBLFNBQUEsSUFBQSxFQUFBLENBQUE7QUFDQSxXQUFBLGVBQUEsTUFBQTtBQUNBLFdBQUEsT0FBQSxTQUFBLFlBQUEsRUFBQSxPQUFBLEVBQUEsNEJBQUE7Ozs7Ozs7O0FBRUEsV0FBQSxPQUFBLFNBQUEsWUFBQSxFQUFBLE9BQUEsRUFBQSw0QkFBQTs7Ozs7Ozs7QUFFQSxvQkFBQSxNQUFBO0FBQ0E7O0FBR0EsV0FBQSxlQUFBLE1BQUE7QUFDQSxXQUFBLE9BQUEsU0FBQSxZQUFBLEVBQUEsT0FBQSxFQUFBLDBCQUFBOzs7Ozs7OztBQU1BLG9CQUFBLE1BQUE7QUFDQTs7QUFHQSxXQUFBLGVBQUEsTUFBQTtBQUNBLFdBQUEsT0FBQSxTQUFBLFlBQUEsRUFBQSxPQUFBLEVBQUEsMEJBQUE7Ozs7Ozs7QUFLQSxvQkFBQSxNQUFBO0FBQ0E7O0FBR0EsU0FBQSxDQUFBLElBQUEsT0FBQSxJQUFBLElBQUEsV0FBQSxFQUFBO0FBQ0EsV0FBQSxlQUFBLE1BQUE7QUFDQSxXQUFBLE9BQUEsU0FBQSxZQUFBLEVBQUEsT0FBQSxFQUFBLDBCQUFBOzs7OztBQUdBLG9CQUFBLE1BQUE7QUFDQTs7QUFHQSxTQUFBLENBQUEsT0FBQSxTQUFBLElBQUEsRUFBQSxJQUFBLENBQUEsT0FBQSxTQUFBLElBQUEsRUFBQSxDQUFBO0FBQ0EsV0FBQSxlQUFBLE1BQUE7QUFDQSxXQUFBLE9BQUEsU0FBQSxZQUFBLEVBQUEsT0FBQSxFQUFBLDRCQUFBOzs7Ozs7O0FBSUEsb0JBQUEsTUFBQTtBQUNBOztBQUdBLFNBQUEsT0FBQSxJQUFBLFNBQUEsWUFBQSxJQUFBLEtBQUEsU0FBQSxJQUFBO0FBQ0EsV0FBQSxlQUFBLE1BQUE7QUFDQSxXQUFBLE9BQUEsU0FBQSxZQUFBLEVBQUEsT0FBQSxFQUFBLG9CQUFBLEVBQUEsTUFBQSxJQUFBLE1BQUEsQ0FBQTtBQUNBLG9CQUFBLE1BQUE7QUFDQTs7QUFHQSxXQUFBLHNCQUFBO0FBQ0E7O0FBR0EsV0FBQSxLQUFBLEtBQUEsVUFBQTs7Ozs7QUFDQSxXQUFBLGNBQUE7QUFDQTs7O0FBSUosV0FBQSxNQUFBLG9DQUFBLEVBQUE7OztDQU1KLGVBQUEscUJBQUE7O0FBRUUsTUFBQSxDQUFBLGdCQUFBLENBQUEsU0FBQTs7QUFHQSxNQUFBOzs7Ozs7Ozs7QUFPRSxPQUFBLENBQUEsSUFBQSxJQUFBO0FBQ0UsUUFBQSxJQUFBLFdBQUEsS0FBQTtBQUNFLFdBQUEsT0FBQSxRQUFBLE1BQUEsT0FBQTs7Ozs7O0FBQ0EsV0FBQSxPQUFBOztBQUVGOzs7QUFJRixTQUFBLE9BQUEsUUFBQSxNQUFBLElBQUEsRUFBQSxhQUFBLEtBQUEsY0FBQSxDQUFBO0FBQ0EsWUFBQTs7O0NBTUosZUFBQSxXQUFBOzs7Ozs7O0FBR0UsU0FBQTs7Ozs7OztDQVVGLElBQUEscUJBQUEsaUJBQUEsWUFBQTtBQUlFLFNBQUEsUUFBQSxVQUFBLGFBQUEsU0FBQTtBQUNFLE9BQUEsS0FBQSxTQUFBLHFCQUFBO0FBQ0EsbUJBQUE7QUFFQSxR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