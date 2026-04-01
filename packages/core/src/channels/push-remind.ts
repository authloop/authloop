/**
 * Push remind — no relay needed.
 * Just a notification to the human: "Approve the push on your device"
 */
export interface PushRemindData {
  type: "push_remind";
  session_id: string;
  hint: string;
}

export function createPushRemindMessage(
  sessionId: string,
  hint: string,
): PushRemindData {
  return {
    type: "push_remind",
    session_id: sessionId,
    hint,
  };
}
