/**
 * A thought shimmers only while it is the tail of an open turn — the same
 * rule production chat uses for `ThinkingBlock`.
 *
 * Keying `active` off the whole turn is what made Cursor sessions look stuck:
 * a long think → tool → think loop kept every earlier "Thinking" row sweeping
 * for minutes after that reasoning had already finished.
 */
export function thoughtIsStreaming(
  inFlight: boolean,
  partIndex: number,
  partCount: number
): boolean {
  return inFlight && partCount > 0 && partIndex === partCount - 1;
}
