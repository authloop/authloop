import { describe, it, expect } from "vitest";
import { validateClick, validateKeyDown, validatePaste, validateScroll } from "./input.js";
import { INPUT_LIMITS } from "./protocol.js";
import type { ClickEvent, KeyDownEvent, PasteEvent, ScrollEvent } from "./protocol.js";

describe("validateClick", () => {
  it("accepts valid coordinates including origin and at-limit", () => {
    expect(validateClick({ type: "click", x: 100, y: 200 }).valid).toBe(true);
    expect(validateClick({ type: "click", x: 0, y: 0 }).valid).toBe(true);
    expect(
      validateClick({ type: "click", x: INPUT_LIMITS.MAX_COORDINATE, y: INPUT_LIMITS.MAX_COORDINATE }).valid,
    ).toBe(true);
  });

  it("rejects negative coordinates", () => {
    const result = validateClick({ type: "click", x: -1, y: 100 });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("non-negative");
  });

  it("rejects non-finite coordinates (NaN, Infinity)", () => {
    expect(validateClick({ type: "click", x: NaN, y: 0 }).valid).toBe(false);
    expect(validateClick({ type: "click", x: Infinity, y: 0 }).valid).toBe(false);
    expect(validateClick({ type: "click", x: 0, y: -Infinity }).valid).toBe(false);
  });

  it("rejects coordinates over the limit", () => {
    const result = validateClick({ type: "click", x: INPUT_LIMITS.MAX_COORDINATE + 1, y: 0 });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain(`<= ${INPUT_LIMITS.MAX_COORDINATE}`);
  });
});

describe("validateKeyDown", () => {
  const base = {
    type: "keydown" as const,
    code: "KeyA",
    modifiers: 0,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
  };

  it("accepts normal keys including special key names at the length limit", () => {
    expect(validateKeyDown({ ...base, key: "a" }).valid).toBe(true);
    expect(validateKeyDown({ ...base, key: "Enter" }).valid).toBe(true);
    expect(validateKeyDown({ ...base, key: "a".repeat(20) }).valid).toBe(true);
  });

  it("rejects empty key", () => {
    const result = validateKeyDown({ ...base, key: "" });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("required");
  });

  it("rejects key name over 20 chars", () => {
    const result = validateKeyDown({ ...base, key: "a".repeat(21) });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("too long");
  });
});

describe("validatePaste", () => {
  it("accepts text up to the size limit (including empty)", () => {
    expect(validatePaste({ type: "paste", text: "" }).valid).toBe(true);
    expect(validatePaste({ type: "paste", text: "hello" }).valid).toBe(true);
    expect(
      validatePaste({ type: "paste", text: "x".repeat(INPUT_LIMITS.MAX_PASTE_LENGTH) }).valid,
    ).toBe(true);
  });

  it("rejects oversized paste", () => {
    const result = validatePaste({
      type: "paste",
      text: "x".repeat(INPUT_LIMITS.MAX_PASTE_LENGTH + 1),
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain(`<= ${INPUT_LIMITS.MAX_PASTE_LENGTH}`);
  });

  it("rejects non-string text", () => {
    const result = validatePaste({ type: "paste", text: 12345 } as unknown as PasteEvent);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("string");
  });
});

describe("validateScroll", () => {
  it("accepts valid scroll events with any delta direction", () => {
    expect(
      validateScroll({ type: "scroll", x: 100, y: 200, deltaX: 0, deltaY: -120 }).valid,
    ).toBe(true);
    expect(
      validateScroll({ type: "scroll", x: 0, y: 0, deltaX: -100, deltaY: 200 }).valid,
    ).toBe(true);
  });

  it("rejects non-finite deltas", () => {
    expect(
      validateScroll({ type: "scroll", x: 0, y: 0, deltaX: NaN, deltaY: 0 }).valid,
    ).toBe(false);
    expect(
      validateScroll({ type: "scroll", x: 0, y: 0, deltaX: 0, deltaY: Infinity }).valid,
    ).toBe(false);
  });

  it("rejects non-finite coordinates", () => {
    expect(
      validateScroll({ type: "scroll", x: NaN, y: 0, deltaX: 0, deltaY: 0 }).valid,
    ).toBe(false);
  });
});
