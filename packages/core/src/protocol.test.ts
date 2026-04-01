import { describe, it, expect } from "vitest";
import { INPUT_LIMITS } from "./protocol.js";

describe("protocol", () => {
  it("exports INPUT_LIMITS constants", () => {
    expect(INPUT_LIMITS.MAX_PASTE_LENGTH).toBe(10_000);
    expect(INPUT_LIMITS.MAX_COORDINATE).toBe(10_000);
    expect(INPUT_LIMITS.MAX_KEYSTROKES_PER_SEC).toBe(30);
    expect(INPUT_LIMITS.MAX_CLICKS_PER_SEC).toBe(10);
  });
});
