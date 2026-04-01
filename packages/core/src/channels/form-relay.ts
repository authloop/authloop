import type { FormField, FormRelayData } from "../protocol.js";

/**
 * Create a FormRelayData message from detected fields.
 */
export function createFormRelayMessage(
  sessionId: string,
  fields: FormField[],
  submitButton?: FormRelayData["submit_button"],
  screenshot?: string,
): FormRelayData {
  return {
    type: "form_relay",
    session_id: sessionId,
    fields,
    submit_button: submitButton,
    screenshot,
  };
}

/**
 * Field focus event — human tapped a field in the viewer.
 * Extension should click the corresponding field on the real page.
 */
export interface FieldFocusEvent {
  type: "field_focus";
  field_id: string;
  x: number;
  y: number;
}

/**
 * Field input event — human typed into a field in the viewer.
 * Extension should dispatch key events to the focused field.
 */
export interface FieldInputEvent {
  type: "field_input";
  field_id: string;
  value: string;
  /** If true, clear the field first then type the full value */
  replace: boolean;
}

/**
 * Form submit event — human clicked submit in the viewer.
 * Extension should click the submit button on the real page.
 */
export interface FormSubmitEvent {
  type: "form_submit";
  x: number;
  y: number;
}

export type FormRelayEvent = FieldFocusEvent | FieldInputEvent | FormSubmitEvent;
