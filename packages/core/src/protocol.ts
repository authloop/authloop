/**
 * Shared protocol types for communication between:
 * - Backend ExtensionRelay DO ↔ Chrome extension
 * - Extension ↔ Web viewer (via relay or LiveKit data channel)
 *
 * These types are the API contract — both repos import from here.
 */

// --- Backend → Extension (via ExtensionRelay DO WebSocket) ---

export interface StartSessionCommand {
  type: "start_session";
  session_id: string;
  service: string;
  context?: {
    url?: string;
    blocker_type?: string;
    hint?: string;
  };
  ttl: number;
  expires_at: string;
  /** LiveKit Cloud URL (e.g. wss://your-project.livekit.cloud) */
  livekit_url?: string;
  /** LiveKit publisher token — extension uses this to publish video */
  livekit_token?: string;
  /** LiveKit room name */
  livekit_room?: string;
}

export interface StopSessionCommand {
  type: "stop_session";
  session_id: string;
}

export type BackendToExtensionMessage = StartSessionCommand | StopSessionCommand;

// --- Extension → Backend (via ExtensionRelay DO WebSocket) ---

export interface SessionAckMessage {
  type: "session_ack";
  session_id: string;
}

export interface AuthCompleteMessage {
  type: "auth_complete";
  session_id: string;
}

export interface SessionErrorMessage {
  type: "session_error";
  session_id: string;
  error: string;
}

export type ExtensionToBackendMessage =
  | SessionAckMessage
  | AuthCompleteMessage
  | SessionErrorMessage;

// --- Input events (viewer → extension, always E2EE encrypted) ---

export interface ClickEvent {
  type: "click";
  x: number;
  y: number;
  button?: "left" | "right" | "middle";
  clickCount?: number;
}

export interface DoubleClickEvent {
  type: "dblclick";
  x: number;
  y: number;
}

export interface KeyDownEvent {
  type: "keydown";
  key: string;
  code: string;
  modifiers: number;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export interface KeyUpEvent {
  type: "keyup";
  key: string;
  code: string;
  modifiers: number;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export interface KeyPressEvent {
  type: "keypress";
  key: string;
}

export interface ScrollEvent {
  type: "scroll";
  x: number;
  y: number;
  deltaX: number;
  deltaY: number;
}

export interface PasteEvent {
  type: "paste";
  text: string;
}

export interface ResolvedEvent {
  type: "resolved";
}

export interface CancelledEvent {
  type: "cancelled";
}

export type InputEvent =
  | ClickEvent
  | DoubleClickEvent
  | KeyDownEvent
  | KeyUpEvent
  | KeyPressEvent
  | ScrollEvent
  | PasteEvent
  | ResolvedEvent
  | CancelledEvent;

// --- E2EE envelope ---

export interface PubKeyMessage {
  type: "pubkey";
  key: string;
}

export interface EncryptedMessage {
  type: "encrypted";
  payload: {
    iv: string;
    ciphertext: string;
    tag: string;
  };
}

// --- Form Relay types (Phase 2) ---

export interface FormField {
  id: string;
  type: "text" | "password" | "tel" | "email" | "number" | "otp";
  name?: string;
  label?: string;
  placeholder?: string;
  autocomplete?: string;
  /** CSS pixel coordinates on the page (for input dispatch) */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FormRelayData {
  type: "form_relay";
  session_id: string;
  fields: FormField[];
  /** Optional contextual screenshot (base64 PNG) */
  screenshot?: string;
  submit_button?: {
    x: number;
    y: number;
    width: number;
    height: number;
    text?: string;
  };
}

// --- Viewport types (Phase 3) ---

export interface StreamMeta {
  type: "stream_meta";
  session_id: string;
  cssWidth: number;
  cssHeight: number;
  pixelRatio: number;
}

// --- Detection result types ---

export type AuthChannel = "form_relay" | "viewport" | "push_remind";

export interface DetectedAuth {
  channel: AuthChannel;
  fields?: FormField[];
  screenshot?: string;
  hint?: string;
}

// --- Input validation constants ---

export const INPUT_LIMITS = {
  MAX_PASTE_LENGTH: 10_000,
  MAX_COORDINATE: 10_000,
  MAX_KEYSTROKES_PER_SEC: 30,
  MAX_CLICKS_PER_SEC: 10,
} as const;
