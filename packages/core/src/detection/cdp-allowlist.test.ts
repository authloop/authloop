import { describe, it, expect } from "vitest";
import { isCdpMethodAllowed, isEvalExpressionSafe } from "./cdp-allowlist.js";

describe("isCdpMethodAllowed", () => {
  it("allows Input.dispatchKeyEvent", () => {
    expect(isCdpMethodAllowed("Input.dispatchKeyEvent")).toBe(true);
  });

  it("blocks Network.getCookies", () => {
    expect(isCdpMethodAllowed("Network.getCookies")).toBe(false);
  });

  it("blocks Storage.getStorageKeyForFrame", () => {
    expect(isCdpMethodAllowed("Storage.getStorageKeyForFrame")).toBe(false);
  });

  it("allows Runtime.evaluate", () => {
    expect(isCdpMethodAllowed("Runtime.evaluate")).toBe(true);
  });
});

describe("isEvalExpressionSafe", () => {
  it("blocks document.cookie", () => {
    expect(isEvalExpressionSafe("document.cookie")).toBe(false);
  });

  it("allows simple expressions", () => {
    expect(isEvalExpressionSafe("(function() { return 1; })()")).toBe(true);
  });

  it("blocks fetch calls", () => {
    expect(isEvalExpressionSafe('fetch("https://evil.com")')).toBe(false);
  });

  it("blocks localStorage access", () => {
    expect(isEvalExpressionSafe("localStorage.getItem('key')")).toBe(false);
  });
});
