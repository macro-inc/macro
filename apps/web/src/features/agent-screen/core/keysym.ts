/**
 * X11 keysyms for keyboard input to the guest. Printable characters map by
 * code point (Latin-1 directly, the rest through the 0x01000000 Unicode
 * range); named keys use the X11 function-key table.
 */

const NAMED_KEYSYMS: Record<string, number> = {
  Backspace: 0xff08,
  Tab: 0xff09,
  Enter: 0xff0d,
  Escape: 0xff1b,
  Delete: 0xffff,
  Home: 0xff50,
  ArrowLeft: 0xff51,
  ArrowUp: 0xff52,
  ArrowRight: 0xff53,
  ArrowDown: 0xff54,
  PageUp: 0xff55,
  PageDown: 0xff56,
  End: 0xff57,
  Insert: 0xff63,
  ContextMenu: 0xff67,
  F1: 0xffbe,
  F2: 0xffbf,
  F3: 0xffc0,
  F4: 0xffc1,
  F5: 0xffc2,
  F6: 0xffc3,
  F7: 0xffc4,
  F8: 0xffc5,
  F9: 0xffc6,
  F10: 0xffc7,
  F11: 0xffc8,
  F12: 0xffc9,
  Shift: 0xffe1,
  Control: 0xffe3,
  CapsLock: 0xffe5,
  Meta: 0xffeb,
  Alt: 0xffe9,
  AltGraph: 0xfe03,
  OS: 0xffeb,
};

/** Right-hand modifiers have their own keysyms. */
const RIGHT_MODIFIER_KEYSYMS: Record<string, number> = {
  Shift: 0xffe2,
  Control: 0xffe4,
  Meta: 0xffec,
  Alt: 0xffea,
};

export const KEYSYM_ESCAPE = NAMED_KEYSYMS.Escape;
export const KEYSYM_CONTROL = NAMED_KEYSYMS.Control;
export const KEYSYM_CONTROL_RIGHT = RIGHT_MODIFIER_KEYSYMS.Control;
export const KEYSYM_ALT = NAMED_KEYSYMS.Alt;
export const KEYSYM_DELETE = NAMED_KEYSYMS.Delete;
export const KEYSYM_TAB = NAMED_KEYSYMS.Tab;
export const KEYSYM_RETURN = NAMED_KEYSYMS.Enter;
export const KEYSYM_BACKSPACE = NAMED_KEYSYMS.Backspace;
export const KEYSYM_SUPER_LEFT = 0xffeb;
export const KEYSYM_SUPER_RIGHT = 0xffec;

export function keysymForCharacter(character: string): number | undefined {
  const codePoint = character.codePointAt(0);
  if (codePoint === undefined) return undefined;
  if ([...character].length !== 1) return undefined;
  if (codePoint < 0x20 || codePoint === 0x7f) return undefined;
  if (codePoint <= 0xff) return codePoint;
  return 0x01000000 + codePoint;
}

/** The keysym for a `KeyboardEvent.key` (and `location` for right modifiers). */
export function keysymForKey(
  key: string,
  location: number = 0
): number | undefined {
  // KeyboardEvent.DOM_KEY_LOCATION_RIGHT
  if (location === 2) {
    const right = RIGHT_MODIFIER_KEYSYMS[key];
    if (right !== undefined) return right;
  }

  const named = NAMED_KEYSYMS[key];
  if (named !== undefined) return named;

  return keysymForCharacter(key);
}
