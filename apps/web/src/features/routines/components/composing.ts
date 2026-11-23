/**
 * Whether a key belongs to an input method still composing text. WebKit sends
 * the Enter that commits a candidate with `isComposing` false but keyCode 229.
 */
export function isComposing(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}
