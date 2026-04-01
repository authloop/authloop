import { INPUT_LIMITS } from "./protocol.js";
import type { ClickEvent, KeyDownEvent, PasteEvent, ScrollEvent } from "./protocol.js";

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateClick(event: ClickEvent): ValidationResult {
  if (!Number.isFinite(event.x) || !Number.isFinite(event.y)) {
    return { valid: false, reason: "coordinates must be finite numbers" };
  }
  if (event.x < 0 || event.y < 0) {
    return { valid: false, reason: "coordinates must be non-negative" };
  }
  if (event.x > INPUT_LIMITS.MAX_COORDINATE || event.y > INPUT_LIMITS.MAX_COORDINATE) {
    return { valid: false, reason: `coordinates must be <= ${INPUT_LIMITS.MAX_COORDINATE}` };
  }
  return { valid: true };
}

export function validateKeyDown(event: KeyDownEvent): ValidationResult {
  if (!event.key || typeof event.key !== "string") {
    return { valid: false, reason: "key is required" };
  }
  if (event.key.length > 20) {
    return { valid: false, reason: "key name too long" };
  }
  return { valid: true };
}

export function validatePaste(event: PasteEvent): ValidationResult {
  if (typeof event.text !== "string") {
    return { valid: false, reason: "paste text must be a string" };
  }
  if (event.text.length > INPUT_LIMITS.MAX_PASTE_LENGTH) {
    return { valid: false, reason: `paste text must be <= ${INPUT_LIMITS.MAX_PASTE_LENGTH} characters` };
  }
  return { valid: true };
}

export function validateScroll(event: ScrollEvent): ValidationResult {
  if (!Number.isFinite(event.x) || !Number.isFinite(event.y)) {
    return { valid: false, reason: "coordinates must be finite numbers" };
  }
  if (!Number.isFinite(event.deltaX) || !Number.isFinite(event.deltaY)) {
    return { valid: false, reason: "delta values must be finite numbers" };
  }
  return { valid: true };
}
