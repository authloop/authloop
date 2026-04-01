import type { DetectedAuth, FormField } from "../protocol.js";
import {
  PASSWORD_SELECTORS,
  OTP_SELECTORS,
  CAPTCHA_SELECTORS,
  USERNAME_SELECTORS,
  SUBMIT_SELECTORS,
  SECURITY_QUESTION_SELECTORS,
} from "./selectors.js";

export type Evaluate = (expression: string) => Promise<any>;

/**
 * Detect the type of auth challenge on the current page.
 * Returns the detected channel (form_relay, viewport, push_remind)
 * and extracted field metadata if applicable.
 */
export async function detectAuth(
  evaluate: Evaluate,
  contextHint?: { blocker_type?: string },
): Promise<DetectedAuth> {
  // Push remind takes priority if agent says so
  if (contextHint?.blocker_type === "push") {
    return { channel: "push_remind", hint: "Approve the push notification on your device" };
  }

  // Check for visual challenges first (captcha -> viewport)
  const hasCaptcha = await evaluate(buildCheckExpression(CAPTCHA_SELECTORS));
  if (hasCaptcha) {
    return { channel: "viewport" };
  }

  // Try to extract form fields
  const fields = await extractFields(evaluate);
  if (fields.length > 0) {
    return { channel: "form_relay", fields };
  }

  // Fallback to viewport if nothing detected
  return { channel: "viewport" };
}

/**
 * Extract interactive form fields from the page.
 * Returns FormField[] with coordinates for input dispatch.
 */
async function extractFields(evaluate: Evaluate): Promise<FormField[]> {
  // Build a single evaluate call that finds all relevant fields and returns their metadata
  const expression = `
    (function() {
      var fields = [];
      var seen = new Set();

      function addField(el, type) {
        if (seen.has(el) || el.offsetWidth === 0 || el.offsetHeight === 0) return;
        if (el.type === 'hidden' || el.disabled || el.readOnly) return;
        seen.add(el);
        var rect = el.getBoundingClientRect();
        fields.push({
          id: el.id || el.name || ('field_' + fields.length),
          type: type,
          name: el.name || undefined,
          label: findLabel(el) || undefined,
          placeholder: el.placeholder || undefined,
          autocomplete: el.autocomplete || undefined,
          x: Math.round(rect.x + rect.width / 2),
          y: Math.round(rect.y + rect.height / 2),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      }

      function findLabel(el) {
        if (el.id) {
          var label = document.querySelector('label[for="' + el.id + '"]');
          if (label) return label.textContent.trim().slice(0, 100);
        }
        var parent = el.closest('label');
        if (parent) return parent.textContent.trim().slice(0, 100);
        if (el.ariaLabel) return el.ariaLabel.slice(0, 100);
        return null;
      }

      ${PASSWORD_SELECTORS.map(s => `document.querySelectorAll('${s}').forEach(function(el) { addField(el, 'password'); });`).join("\n      ")}

      ${OTP_SELECTORS.map(s => `document.querySelectorAll('${s}').forEach(function(el) { addField(el, 'otp'); });`).join("\n      ")}

      if (fields.length > 0) {
        ${USERNAME_SELECTORS.map(s => `document.querySelectorAll('${s}').forEach(function(el) { addField(el, 'email'); });`).join("\n        ")}
      }

      ${SECURITY_QUESTION_SELECTORS.map(s => `document.querySelectorAll('${s}').forEach(function(el) { addField(el, 'text'); });`).join("\n      ")}

      var submitBtn = null;
      ${SUBMIT_SELECTORS.map(s => `if (!submitBtn) { var el = document.querySelector('${s}'); if (el && el.offsetWidth > 0) { var r = el.getBoundingClientRect(); submitBtn = { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), width: Math.round(r.width), height: Math.round(r.height), text: (el.textContent || el.value || '').trim().slice(0, 50) }; } }`).join("\n      ")}

      return { fields: fields, submitBtn: submitBtn };
    })()
  `;

  const result = await evaluate(expression);
  if (!result || !result.fields) return [];
  return result.fields as FormField[];
}

function buildCheckExpression(selectors: string[]): string {
  const checks = selectors.map(s => `!!document.querySelector('${s}')`).join(" || ");
  return `(${checks})`;
}

// Re-export for consumers
export {
  PASSWORD_SELECTORS,
  OTP_SELECTORS,
  CAPTCHA_SELECTORS,
  USERNAME_SELECTORS,
  SUBMIT_SELECTORS,
  SECURITY_QUESTION_SELECTORS,
} from "./selectors.js";
