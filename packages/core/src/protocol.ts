/**
 * Shared protocol types for communication between:
 * - Agent (MCP/plugin) ↔ WebSocket relay ↔ Web viewer
 *
 * These types are the API contract.
 */

// --- Input events (viewer → agent, always E2EE encrypted) ---

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

// --- Input validation constants ---

export const INPUT_LIMITS = {
  MAX_PASTE_LENGTH: 10_000,
  MAX_COORDINATE: 10_000,
  MAX_KEYSTROKES_PER_SEC: 30,
  MAX_CLICKS_PER_SEC: 10,
} as const;
