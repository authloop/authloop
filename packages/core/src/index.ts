// CDP engine + E2EE (Web Crypto) + protocol types + input validation + detection

// CDP engine (quality 85, 1920x1080, Web Crypto E2EE)
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
export { BrowserStream, type StreamResult } from "./stream.js";
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
  type FormField,
  type FormRelayData,
  type AuthChannel,
  type DetectedAuth,
  INPUT_LIMITS,
} from "./protocol.js";

// Detection layer
export { detectAuth, type Evaluate } from "./detection/index.js";
export {
  PASSWORD_SELECTORS,
  OTP_SELECTORS,
  CAPTCHA_SELECTORS,
  USERNAME_SELECTORS,
  SUBMIT_SELECTORS,
  SECURITY_QUESTION_SELECTORS,
} from "./detection/selectors.js";
export {
  isCdpMethodAllowed,
  isEvalExpressionSafe,
  ALLOWED_CDP_METHODS,
  BLOCKED_EVAL_PATTERNS,
} from "./detection/cdp-allowlist.js";

// Channels
export {
  createFormRelayMessage,
  type FieldFocusEvent,
  type FieldInputEvent,
  type FormSubmitEvent,
  type FormRelayEvent,
} from "./channels/form-relay.js";
export {
  createPushRemindMessage,
  type PushRemindData,
} from "./channels/push-remind.js";
