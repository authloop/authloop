// CDP engine + E2EE (Web Crypto) + protocol types + input validation

// CDP engine
export {
  startSession,
  waitForStatus,
  stopSession,
  _resetActiveSession,
  _getActiveSession,
  type ToHumanInput,
  type StartSessionOutput,
  type SessionStatusOutput,
  type SessionStatus,
} from "./session.js";
export {
  BrowserStream,
  type StreamResult,
  type ScreencastOptions,
  type ScreencastQuality,
} from "./stream.js";
export { CdpClient } from "./cdp.js";

// E2EE (Web Crypto API — works in Node 18+, Chrome, mobile)
export { E2EESession } from "./crypto.js";

// Input validation
export {
  validateClick,
  validateKeyDown,
  validatePaste,
  validateScroll,
  type ValidationResult,
} from "./input.js";

// Protocol types
export {
  type InputEvent,
  type ClickEvent,
  type DoubleClickEvent,
  type KeyDownEvent,
  type KeyUpEvent,
  type KeyPressEvent,
  type ScrollEvent,
  type PasteEvent,
  type ResolvedEvent,
  type CancelledEvent,
  type PubKeyMessage,
  type EncryptedMessage,
  INPUT_LIMITS,
} from "./protocol.js";
