import { describe, it, expect, vi } from "vitest";
import { detectAuth } from "./index.js";
import type { Evaluate } from "./index.js";

function mockEvaluate(responses: Map<string, any>): Evaluate {
  return async (expression: string) => {
    for (const [key, value] of responses) {
      if (expression.includes(key)) return value;
    }
    return null;
  };
}

describe("detectAuth", () => {
  it("returns viewport when captcha selectors match", async () => {
    const evaluate = mockEvaluate(new Map([
      ["recaptcha", true],
    ]));
    const result = await detectAuth(evaluate);
    expect(result.channel).toBe("viewport");
  });

  it("returns form_relay with password field", async () => {
    const evaluate = vi.fn<Evaluate>();
    // First call: captcha check -> false
    evaluate.mockResolvedValueOnce(false);
    // Second call: field extraction -> password fields
    evaluate.mockResolvedValueOnce({
      fields: [
        {
          id: "password",
          type: "password",
          name: "password",
          x: 100,
          y: 200,
          width: 200,
          height: 30,
        },
      ],
      submitBtn: null,
    });

    const result = await detectAuth(evaluate);
    expect(result.channel).toBe("form_relay");
    expect(result.fields).toHaveLength(1);
    expect(result.fields![0].type).toBe("password");
  });

  it("returns form_relay with otp field", async () => {
    const evaluate = vi.fn<Evaluate>();
    evaluate.mockResolvedValueOnce(false);
    evaluate.mockResolvedValueOnce({
      fields: [
        {
          id: "otp-input",
          type: "otp",
          name: "otp",
          x: 150,
          y: 250,
          width: 180,
          height: 30,
        },
      ],
      submitBtn: null,
    });

    const result = await detectAuth(evaluate);
    expect(result.channel).toBe("form_relay");
    expect(result.fields).toHaveLength(1);
    expect(result.fields![0].type).toBe("otp");
  });

  it("returns viewport as fallback when no fields detected", async () => {
    const evaluate = vi.fn<Evaluate>();
    evaluate.mockResolvedValueOnce(false);
    evaluate.mockResolvedValueOnce({ fields: [], submitBtn: null });

    const result = await detectAuth(evaluate);
    expect(result.channel).toBe("viewport");
  });

  it("returns push_remind when blocker_type is push", async () => {
    const evaluate = vi.fn<Evaluate>();
    const result = await detectAuth(evaluate, { blocker_type: "push" });
    expect(result.channel).toBe("push_remind");
    expect(result.hint).toBe("Approve the push notification on your device");
    // evaluate should not have been called
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("returns form_relay with password, username, and submit", async () => {
    const evaluate = vi.fn<Evaluate>();
    evaluate.mockResolvedValueOnce(false);
    evaluate.mockResolvedValueOnce({
      fields: [
        {
          id: "password",
          type: "password",
          name: "password",
          x: 100,
          y: 250,
          width: 200,
          height: 30,
        },
        {
          id: "email",
          type: "email",
          name: "email",
          x: 100,
          y: 200,
          width: 200,
          height: 30,
        },
      ],
      submitBtn: {
        x: 100,
        y: 300,
        width: 100,
        height: 40,
        text: "Sign In",
      },
    });

    const result = await detectAuth(evaluate);
    expect(result.channel).toBe("form_relay");
    expect(result.fields).toHaveLength(2);
    const types = result.fields!.map(f => f.type);
    expect(types).toContain("password");
    expect(types).toContain("email");
  });
});
