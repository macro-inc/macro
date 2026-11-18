const MEETING_WORDS =
  /\b(meet|meeting|call|chat|catch up|sync|hop on|jump on|coffee|lunch|dinner|drinks|demo|interview|invite|schedule|book a time|availability|available)\b/i;

const TIME_WORDS =
  /\b(today|tonight|tomorrow|next (week|month)|this (week|morning|afternoon|evening)|(mon|tues?|wed(nes)?|thu(rs)?|fri|sat(ur)?|sun)(day)?|morning|afternoon|evening|noon|\d{1,2}(:\d{2})?\s?(am|pm)|\d{1,2}:\d{2})\b/i;

/**
 * Whether a draft reads like it proposes a meeting: a meeting word and a time
 * reference, such as "Want to meet tomorrow at 2pm?".
 *
 * TODO: replace this keyword heuristic with the Jev binary classifier
 * (cognition `/decisions`, or the `calendar` score from
 * `/universal_input/classify`), checked on a typing pause, once its latency
 * and cost per draft are acceptable.
 */
export function proposesMeeting(text: string): boolean {
  return MEETING_WORDS.test(text) && TIME_WORDS.test(text);
}
