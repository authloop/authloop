import { describe, it, expect } from "vitest";
import { validateClick, validateKeyDown, validatePaste, validateScroll } from "./input.js";
import { INPUT_LIMITS } from "./protocol.js";
import type { ClickEvent, KeyDownEvent, PasteEvent, ScrollEvent } from "./protocol.js";

describe("validateClick", () => {
  it("accepts a valid click", () => {
    const event: ClickEvent = { type: "click", x: 100, y: 200 };
    expect(validateClick(event)).toEqual({ valid: true });
  });

  it("accepts a click at origin (0, 0)", () => {
    const event: ClickEvent = { type: "click", x: 0, y: 0 };
    expect(validateClick(event)).toEqual({ valid: true });
  });

  it("accepts a click at the coordinate limit", () => {
    const event: ClickEvent = { type: "click", x: INPUT_LIMITS.MAX_COORDINATE, y: INPUT_LIMITS.MAX_COORDINATE };
    expect(validateClick(event)).toEqual({ valid: true });
  });

  it("rejects negative x coordinate", () => {
    const event: ClickEvent = { type: "click", x: -1, y: 100 };
    const result = validateClick(event);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("non-negative");
  });

  it("rejects negative y coordinate", () => {
    const event: ClickEvent = { type: "click", x: 100, y: -5 };
    const result = validateClick(event);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("non-negative");
  });

  it("rejects NaN x coordinate", () => {
    const event: ClickEvent = { type: "click", x: NaN, y: 100 };
    const result = validateClick(event);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("finite");
  });

  it("rejects NaN y coordinate", () => {
    const event: ClickEvent = { type: "click", x: 100, y: NaN };
    const result = validateClick(event);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("finite");
  });

  it("rejects Infinity x coordinate", () => {
    const event: ClickEvent = { type: "click", x: Infinity, y: 100 };
    const result = validateClick(event);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("finite");
  });

  it("rejects -Infinity y coordinate", () => {
    const event: ClickEvent = { type: "click", x: 100, y: -Infinity };
    const result = validateClick(event);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("finite");
  });

  it("rejects x coordinate over the limit", () => {
    const event: ClickEvent = { type: "click", x: INPUT_LIMITS.MAX_COORDINATE + 1, y: 100 };
    const result = validateClick(event);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain(`<= ${INPUT_LIMITS.MAX_COORDINATE}`);
  });

  it("rejects y coordinate over the limit", () => {
    const event: ClickEvent = { type: "click", x: 100, y: INPUT_LIMITS.MAX_COORDINATE + 1 };
    const result = validateClick(event);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain(`<= ${INPUT_LIMITS.MAX_COORDINATE}`);
  });
});

describe("validateKeyDown", () => {
  const base = { type: "keydown" as const, code: "KeyA", modifiers: 0, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };

  it("accepts a valid key", () => {
    const event: KeyDownEvent = { ...base, key: "a" };
    expect(validateKeyDown(event)).toEqual({ valid: true });
  });

  it("accepts special keys", () => {
    const event: KeyDownEvent = { ...base, key: "Enter" };
    expect(validateKeyDown(event)).toEqual({ valid: true });
  });

  it("rejects empty key string", () => {
    const event: KeyDownEvent = { ...base, key: "" };
    const result = validateKeyDown(event);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("key is required");
  });

  it("rejects overly long key name (> 20 chars)", () => {
    const event: KeyDownEvent = { ...base, key: "a".repeat(21) };
    const result = validateKeyDown(event);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("too long");
  });

  it("accepts key name at exactly 20 chars", () => {
    const event: KeyDownEvent = { ...base, key: "a".repeat(20) };
    expect(validateKeyDown(event)).toEqual({ valid: true });
  });
});

describe("validatePaste", () => {
  it("accepts a valid paste", () => {
    const event: PasteEvent = { type: "paste", text: "hello world" };
    expect(validatePaste(event)).toEqual({ valid: true });
  });

  it("accepts an empty paste", () => {
    const event: PasteEvent = { type: "paste", text: "" };
    expect(validatePaste(event)).toEqual({ valid: true });
  });

  it("accepts paste at the character limit", () => {
    const event: PasteEvent = { type: "paste", text: "x".repeat(INPUT_LIMITS.MAX_PASTE_LENGTH) };
    expect(validatePaste(event)).toEqual({ valid: true });
  });

  it("rejects paste over the character limit", () => {
    const event: PasteEvent = { type: "paste", text: "x".repeat(INPUT_LIMITS.MAX_PASTE_LENGTH + 1) };
    const result = validatePaste(event);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain(`<= ${INPUT_LIMITS.MAX_PASTE_LENGTH}`);
  });

  it("rejects non-string text", () => {
    const event = { type: "paste", text: 12345 } as unknown as PasteEvent;
    const result = validatePaste(event);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("must be a string");
  });
});

describe("validateScroll", () => {
  it("accepts a valid scroll", () => {
    const event: ScrollEvent = { type: "scroll", x: 100, y: 200, deltaX: 0, deltaY: -120 };
    expect(validateScroll(event)).toEqual({ valid: true });
  });

  it("accepts zero deltas", () => {
    const event: ScrollEvent = { type: "scroll", x: 0, y: 0, deltaX: 0, deltaY: 0 };
    expect(validateScroll(event)).toEqual({ valid: true });
  });

  it("accepts negative deltas (scroll up/left)", () => {
    const event: ScrollEvent = { type: "scroll", x: 50, y: 50, deltaX: -100, deltaY: -200 };
    expect(validateScroll(event)).toEqual({ valid: true });
  });

  it("rejects NaN deltaX", () => {
    const event: ScrollEvent = { type: "scroll", x: 100, y: 200, deltaX: NaN, deltaY: 0 };
    const result = validateScroll(event);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("delta");
  });

  it("rejects NaN deltaY", () => {
    const event: ScrollEvent = { type: "scroll", x: 100, y: 200, deltaX: 0, deltaY: NaN };
    const result = validateScroll(event);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("delta");
  });

  it("rejects Infinity in coordinates", () => {
    const event: ScrollEvent = { type: "scroll", x: Infinity, y: 200, deltaX: 0, deltaY: 0 };
    const result = validateScroll(event);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("finite");
  });

  it("rejects NaN in coordinates", () => {
    const event: ScrollEvent = { type: "scroll", x: 100, y: NaN, deltaX: 0, deltaY: 0 };
    const result = validateScroll(event);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("finite");
  });
});
