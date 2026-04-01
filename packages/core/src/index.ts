// v2: Protocol types + E2EE crypto (Web Crypto API)
// CDP client, BrowserStream, and agent-side session management are removed.
// The Chrome extension now handles all browser capture and input dispatch.

export { E2EESession } from "./crypto.js";

export {
  validateClick,
  validateKeyDown,
  validatePaste,
  validateScroll,
  type ValidationResult,
} from "./input.js";

export {
  type BackendToExtensionMessage,
  type StartSessionCommand,
  type StopSessionCommand,
  type ExtensionToBackendMessage,
  type SessionAckMessage,
  type AuthCompleteMessage,
  type SessionErrorMessage,
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
  type StreamMeta,
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
