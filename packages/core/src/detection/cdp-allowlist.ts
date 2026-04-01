/**
 * CDP methods allowed for extension use.
 * Anything not on this list is rejected to prevent data exfiltration.
 */
export const ALLOWED_CDP_METHODS = new Set([
  // Input dispatch
  "Input.dispatchMouseEvent",
  "Input.dispatchKeyEvent",
  "Input.insertText",

  // Page inspection (for detection)
  "Runtime.evaluate",

  // Navigation
  "Page.navigate",
  "Page.reload",

  // Screenshots (for viewport mode, Phase 3)
  "Page.captureScreenshot",
]);

/**
 * Runtime.evaluate expressions that are allowed.
 * We can't allowlist arbitrary expressions, but we can check
 * that they don't access sensitive APIs.
 */
export const BLOCKED_EVAL_PATTERNS = [
  /document\.cookie/i,
  /localStorage/i,
  /sessionStorage/i,
  /indexedDB/i,
  /navigator\.credentials/i,
  /fetch\s*\(/i,
  /XMLHttpRequest/i,
  /WebSocket/i,
  /window\.open/i,
];

export function isCdpMethodAllowed(method: string): boolean {
  return ALLOWED_CDP_METHODS.has(method);
}

export function isEvalExpressionSafe(expression: string): boolean {
  return !BLOCKED_EVAL_PATTERNS.some(pattern => pattern.test(expression));
}
