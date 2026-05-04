import { For, type JSX } from 'solid-js';
import { createStore, produce } from 'solid-js/store';

interface KeyState {
  pressed: boolean;
  highlighted: boolean;
}

type KeyboardState = Record<string, KeyState>;

/**
 * A shortcut may have multiple alternative `combos` (e.g. "press `c` OR `cmd+k`").
 * Each combo is a list of groups; each group is a list of equivalent `e.code`
 * values (e.g. `cmd` -> [`MetaLeft`, `MetaRight`]). The shortcut is active if
 * any combo's groups all match the currently pressed set, with no extras.
 */
interface Shortcut {
  combos: string[][][];
  active: boolean;
}

type ShortcutsState = Record<string, Shortcut>;

const MODIFIER_CODES: Record<string, string[]> = {
  cmd:   ['MetaLeft'],
  meta:  ['MetaLeft'],
  ctrl:  ['ControlLeft'],
  shift: ['ShiftLeft'],
  opt:   ['AltLeft'],
  alt:   ['AltLeft'],
};

const SYMBOL_CODE: Record<string, string> = {
  '/':  'Slash',
  '\\': 'Backslash',
  ';':  'Semicolon',
  "'":  'Quote',
  ',':  'Comma',
  '.':  'Period',
  '-':  'Minus',
  '=':  'Equal',
  '`':  'Backquote',
  '[':  'BracketLeft',
  ']':  'BracketRight',
};

const NAMED_CODE: Record<string, string> = {
  enter:      'Enter',
  space:      'Space',
  tab:        'Tab',
  escape:     'Escape',
  esc:        'Escape',
  backspace:  'Backspace',
  delete:     'Backspace',
  arrowup:    'ArrowUp',
  arrowdown:  'ArrowDown',
  arrowleft:  'ArrowLeft',
  arrowright: 'ArrowRight',
  capslock:   'CapsLock',
  fn:         'Fn',
};

interface KeyDef {
  name: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  labelX: number;
  labelY: number;
}

const KEYS: KeyDef[] = [
  // Row 1: Function keys
  { name: 'Escape',       label: 'esc',   x:  0.0763, y:  0.0763, width: 2.8473, height: 1.8473, labelX:  1.50, labelY:  1.0228 },
  { name: 'F1',           label: 'F1',    x:  3.0763, y:  0.0763, width: 1.8473, height: 1.8473, labelX:  4.00, labelY:  1.0228 },
  { name: 'F2',           label: 'F2',    x:  5.0763, y:  0.0763, width: 1.8473, height: 1.8473, labelX:  6.00, labelY:  1.0228 },
  { name: 'F3',           label: 'F3',    x:  7.0763, y:  0.0763, width: 1.8473, height: 1.8473, labelX:  8.00, labelY:  1.0228 },
  { name: 'F4',           label: 'F4',    x:  9.0763, y:  0.0763, width: 1.8473, height: 1.8473, labelX: 10.00, labelY:  1.0228 },
  { name: 'F5',           label: 'F5',    x: 11.0763, y:  0.0763, width: 1.8473, height: 1.8473, labelX: 12.00, labelY:  1.0228 },
  { name: 'F6',           label: 'F6',    x: 13.0763, y:  0.0763, width: 1.8473, height: 1.8473, labelX: 14.00, labelY:  1.0228 },
  { name: 'F7',           label: 'F7',    x: 15.0763, y:  0.0763, width: 1.8473, height: 1.8473, labelX: 16.00, labelY:  1.0228 },
  { name: 'F8',           label: 'F8',    x: 17.0763, y:  0.0763, width: 1.8473, height: 1.8473, labelX: 18.00, labelY:  1.0228 },
  { name: 'F9',           label: 'F9',    x: 19.0763, y:  0.0763, width: 1.8473, height: 1.8473, labelX: 20.00, labelY:  1.0228 },
  { name: 'F10',          label: 'F10',   x: 21.0763, y:  0.0763, width: 1.8473, height: 1.8473, labelX: 22.00, labelY:  1.0228 },
  { name: 'F11',          label: 'F11',   x: 23.0763, y:  0.0763, width: 1.8473, height: 1.8473, labelX: 24.00, labelY:  1.0228 },
  { name: 'F12',          label: 'F12',   x: 25.0763, y:  0.0763, width: 1.8473, height: 1.8473, labelX: 26.00, labelY:  1.0228 },
  { name: 'F13',          label: 'F13',   x: 27.0763, y:  0.0763, width: 1.8473, height: 1.8473, labelX: 28.00, labelY:  1.0228 },
  // Row 2: Number row
  { name: 'Backquote',    label: '`',     x:  0.0763, y:  2.0763, width: 1.8473, height: 1.8473, labelX:  1.00, labelY:  3.0228 },
  { name: 'Digit1',       label: '1',     x:  2.0763, y:  2.0763, width: 1.8473, height: 1.8473, labelX:  3.00, labelY:  3.0228 },
  { name: 'Digit2',       label: '2',     x:  4.0763, y:  2.0763, width: 1.8473, height: 1.8473, labelX:  5.00, labelY:  3.0228 },
  { name: 'Digit3',       label: '3',     x:  6.0763, y:  2.0763, width: 1.8473, height: 1.8473, labelX:  7.00, labelY:  3.0228 },
  { name: 'Digit4',       label: '4',     x:  8.0763, y:  2.0763, width: 1.8473, height: 1.8473, labelX:  9.00, labelY:  3.0228 },
  { name: 'Digit5',       label: '5',     x: 10.0763, y:  2.0763, width: 1.8473, height: 1.8473, labelX: 11.00, labelY:  3.0228 },
  { name: 'Digit6',       label: '6',     x: 12.0763, y:  2.0763, width: 1.8473, height: 1.8473, labelX: 13.00, labelY:  3.0228 },
  { name: 'Digit7',       label: '7',     x: 14.0763, y:  2.0763, width: 1.8473, height: 1.8473, labelX: 15.00, labelY:  3.0228 },
  { name: 'Digit8',       label: '8',     x: 16.0763, y:  2.0763, width: 1.8473, height: 1.8473, labelX: 17.00, labelY:  3.0228 },
  { name: 'Digit9',       label: '9',     x: 18.0763, y:  2.0763, width: 1.8473, height: 1.8473, labelX: 19.00, labelY:  3.0228 },
  { name: 'Digit0',       label: '0',     x: 20.0763, y:  2.0763, width: 1.8473, height: 1.8473, labelX: 21.00, labelY:  3.0228 },
  { name: 'Minus',        label: '-',     x: 22.0763, y:  2.0763, width: 1.8473, height: 1.8473, labelX: 23.00, labelY:  3.0228 },
  { name: 'Equal',        label: '=',     x: 24.0763, y:  2.0763, width: 1.8473, height: 1.8473, labelX: 25.00, labelY:  3.0228 },
  { name: 'Backspace',    label: 'del',   x: 26.0763, y:  2.0763, width: 2.8473, height: 1.8473, labelX: 27.50, labelY:  3.0228 },
  // Row 3: QWERTY row
  { name: 'Tab',          label: 'tab',   x:  0.0763, y:  4.0763, width: 2.8473, height: 1.8473, labelX:  1.50, labelY:  5.0228 },
  { name: 'KeyQ',         label: 'Q',     x:  3.0763, y:  4.0763, width: 1.8473, height: 1.8473, labelX:  4.00, labelY:  5.0228 },
  { name: 'KeyW',         label: 'W',     x:  5.0763, y:  4.0763, width: 1.8473, height: 1.8473, labelX:  6.00, labelY:  5.0228 },
  { name: 'KeyE',         label: 'E',     x:  7.0763, y:  4.0763, width: 1.8473, height: 1.8473, labelX:  8.00, labelY:  5.0228 },
  { name: 'KeyR',         label: 'R',     x:  9.0763, y:  4.0763, width: 1.8473, height: 1.8473, labelX: 10.00, labelY:  5.0228 },
  { name: 'KeyT',         label: 'T',     x: 11.0763, y:  4.0763, width: 1.8473, height: 1.8473, labelX: 12.00, labelY:  5.0228 },
  { name: 'KeyY',         label: 'Y',     x: 13.0763, y:  4.0763, width: 1.8473, height: 1.8473, labelX: 14.00, labelY:  5.0228 },
  { name: 'KeyU',         label: 'U',     x: 15.0763, y:  4.0763, width: 1.8473, height: 1.8473, labelX: 16.00, labelY:  5.0228 },
  { name: 'KeyI',         label: 'I',     x: 17.0763, y:  4.0763, width: 1.8473, height: 1.8473, labelX: 18.00, labelY:  5.0228 },
  { name: 'KeyO',         label: 'O',     x: 19.0763, y:  4.0763, width: 1.8473, height: 1.8473, labelX: 20.00, labelY:  5.0228 },
  { name: 'KeyP',         label: 'P',     x: 21.0763, y:  4.0763, width: 1.8473, height: 1.8473, labelX: 22.00, labelY:  5.0228 },
  { name: 'BracketLeft',  label: '[',     x: 23.0763, y:  4.0763, width: 1.8473, height: 1.8473, labelX: 24.00, labelY:  5.0228 },
  { name: 'BracketRight', label: ']',     x: 25.0763, y:  4.0763, width: 1.8473, height: 1.8473, labelX: 26.00, labelY:  5.0228 },
  { name: 'Backslash',    label: '\\',    x: 27.0763, y:  4.0763, width: 1.8473, height: 1.8473, labelX: 28.00, labelY:  5.0228 },
  // Row 4: Home row
  { name: 'CapsLock',     label: 'caps',  x:  0.0763, y:  6.0763, width: 3.3473, height: 1.8473, labelX:  1.75, labelY:  7.0228 },
  { name: 'KeyA',         label: 'A',     x:  3.5763, y:  6.0763, width: 1.8473, height: 1.8473, labelX:  4.50, labelY:  7.0228 },
  { name: 'KeyS',         label: 'S',     x:  5.5763, y:  6.0763, width: 1.8473, height: 1.8473, labelX:  6.50, labelY:  7.0228 },
  { name: 'KeyD',         label: 'D',     x:  7.5763, y:  6.0763, width: 1.8473, height: 1.8473, labelX:  8.50, labelY:  7.0228 },
  { name: 'KeyF',         label: 'F',     x:  9.5763, y:  6.0763, width: 1.8473, height: 1.8473, labelX: 10.50, labelY:  7.0228 },
  { name: 'KeyG',         label: 'G',     x: 11.5763, y:  6.0763, width: 1.8473, height: 1.8473, labelX: 12.50, labelY:  7.0228 },
  { name: 'KeyH',         label: 'H',     x: 13.5763, y:  6.0763, width: 1.8473, height: 1.8473, labelX: 14.50, labelY:  7.0228 },
  { name: 'KeyJ',         label: 'J',     x: 15.5763, y:  6.0763, width: 1.8473, height: 1.8473, labelX: 16.50, labelY:  7.0228 },
  { name: 'KeyK',         label: 'K',     x: 17.5763, y:  6.0763, width: 1.8473, height: 1.8473, labelX: 18.50, labelY:  7.0228 },
  { name: 'KeyL',         label: 'L',     x: 19.5763, y:  6.0763, width: 1.8473, height: 1.8473, labelX: 20.50, labelY:  7.0228 },
  { name: 'Semicolon',    label: ';',     x: 21.5763, y:  6.0763, width: 1.8473, height: 1.8473, labelX: 22.50, labelY:  7.0228 },
  { name: 'Quote',        label: "'",     x: 23.5763, y:  6.0763, width: 1.8473, height: 1.8473, labelX: 24.50, labelY:  7.0228 },
  { name: 'Enter',        label: 'enter', x: 25.5763, y:  6.0763, width: 3.3473, height: 1.8473, labelX: 27.25, labelY:  7.0228 },
  // Row 5: Bottom letter row
  { name: 'ShiftLeft',    label: 'shift', x:  0.0763, y:  8.0763, width: 4.3473, height: 1.8473, labelX:  2.25, labelY:  9.0228 },
  { name: 'KeyZ',         label: 'Z',     x:  4.5763, y:  8.0763, width: 1.8473, height: 1.8473, labelX:  5.50, labelY:  9.0228 },
  { name: 'KeyX',         label: 'X',     x:  6.5763, y:  8.0763, width: 1.8473, height: 1.8473, labelX:  7.50, labelY:  9.0228 },
  { name: 'KeyC',         label: 'C',     x:  8.5763, y:  8.0763, width: 1.8473, height: 1.8473, labelX:  9.50, labelY:  9.0228 },
  { name: 'KeyV',         label: 'V',     x: 10.5763, y:  8.0763, width: 1.8473, height: 1.8473, labelX: 11.50, labelY:  9.0228 },
  { name: 'KeyB',         label: 'B',     x: 12.5763, y:  8.0763, width: 1.8473, height: 1.8473, labelX: 13.50, labelY:  9.0228 },
  { name: 'KeyN',         label: 'N',     x: 14.5763, y:  8.0763, width: 1.8473, height: 1.8473, labelX: 15.50, labelY:  9.0228 },
  { name: 'KeyM',         label: 'M',     x: 16.5763, y:  8.0763, width: 1.8473, height: 1.8473, labelX: 17.50, labelY:  9.0228 },
  { name: 'Comma',        label: ',',     x: 18.5763, y:  8.0763, width: 1.8473, height: 1.8473, labelX: 19.50, labelY:  9.0228 },
  { name: 'Period',       label: '.',     x: 20.5763, y:  8.0763, width: 1.8473, height: 1.8473, labelX: 21.50, labelY:  9.0228 },
  { name: 'Slash',        label: '/',     x: 22.5763, y:  8.0763, width: 1.8473, height: 1.8473, labelX: 23.50, labelY:  9.0228 },
  { name: 'ShiftRight',   label: 'shift', x: 24.5763, y:  8.0763, width: 4.3473, height: 1.8473, labelX: 26.75, labelY:  9.0228 },
  // Row 6: Bottom row
  { name: 'Fn',           label: 'fn',    x:  0.0763, y: 10.0763, width: 1.8473, height: 1.8473, labelX:  1.00, labelY: 11.0228 },
  { name: 'ControlLeft',  label: 'ctrl',  x:  2.0763, y: 10.0763, width: 1.8473, height: 1.8473, labelX:  3.00, labelY: 11.0228 },
  { name: 'AltLeft',      label: 'opt',   x:  4.0763, y: 10.0763, width: 1.8473, height: 1.8473, labelX:  5.00, labelY: 11.0228 },
  { name: 'MetaLeft',     label: 'cmd',   x:  6.0763, y: 10.0763, width: 2.3473, height: 1.8473, labelX:  7.25, labelY: 11.0228 },
  { name: 'Space',        label: 'space', x:  8.5763, y: 10.0763, width: 9.8473, height: 1.8473, labelX: 13.50, labelY: 11.0228 },
  { name: 'MetaRight',    label: 'cmd',   x: 18.5763, y: 10.0763, width: 2.3473, height: 1.8473, labelX: 19.75, labelY: 11.0228 },
  { name: 'AltRight',     label: 'opt',   x: 21.0763, y: 10.0763, width: 1.8473, height: 1.8473, labelX: 22.00, labelY: 11.0228 },
  { name: 'ArrowLeft',    label: '◂',     x: 23.0763, y: 10.0763, width: 1.8473, height: 1.8473, labelX: 24.00, labelY: 11.0228 },
  { name: 'ArrowUp',      label: '▴',     x: 25.0763, y: 10.0763, width: 1.8473, height: 0.8473, labelX: 26.00, labelY: 10.5000 },
  { name: 'ArrowDown',    label: '▾',     x: 25.0763, y: 11.0763, width: 1.8473, height: 0.8473, labelX: 26.00, labelY: 11.5000 },
  { name: 'ArrowRight',   label: '▸',     x: 27.0763, y: 10.0763, width: 1.8473, height: 1.8473, labelX: 28.00, labelY: 11.0228 },
];

function initialKeyboardState(): KeyboardState {
  const state: KeyboardState = {};
  for (const key of KEYS) {
    state[key.name] = { pressed: false, highlighted: false };
  }
  return state;
}

export const [keyboard, setKeyboard] = createStore<KeyboardState>(initialKeyboardState());
export const [shortcuts, setShortcuts] = createStore<ShortcutsState>({});

export function setHighlight(names: string[]): void {
  const next = new Set(names);
  for (const key of KEYS) {
    const shouldHighlight = next.has(key.name);
    if (keyboard[key.name].highlighted !== shouldHighlight) {
      setKeyboard(key.name, 'highlighted', shouldHighlight);
    }
  }
}

export function clearHighlight(): void {
  setHighlight([]);
}

/**
 * Parse a human-readable combo string (e.g. `cmd+k`, `shift+arrowdown`) into
 * groups of equivalent `e.code` values. Unknown tokens are dropped.
 */
export function parseShortcut(combo: string): string[][] {
  return combo
    .split('+')
    .map(tokenToCodes)
    .filter((group) => group.length > 0);
}

function tokenToCodes(token: string): string[] {
  const lower = token.toLowerCase();
  if (lower in MODIFIER_CODES) return MODIFIER_CODES[lower];
  if (token in SYMBOL_CODE)    return [SYMBOL_CODE[token]];
  if (lower in NAMED_CODE)     return [NAMED_CODE[lower]];
  if (/^[a-z]$/.test(lower))   return [`Key${lower.toUpperCase()}`];
  if (/^[0-9]$/.test(lower))   return [`Digit${lower}`];
  return [];
}

let nextShortcutId = 0;

/**
 * Register a shortcut described by one or more combo strings.
 * Returns an opaque id used to read `shortcuts[id].active` or
 * to highlight the keys via {@link highlightShortcut}.
 */
export function registerShortcut(combos: string[]): string {
  const id = `shortcut-${nextShortcutId++}`;
  setShortcuts(id, {
    combos: combos.map(parseShortcut),
    active: false,
  });
  return id;
}

export function unregisterShortcut(id: string): void {
  setShortcuts(produce((s) => { delete s[id]; }));
}

/** Highlight every key referenced by a registered shortcut. */
export function highlightShortcut(id: string): void {
  const s = shortcuts[id];
  if (!s) {
    clearHighlight();
    return;
  }
  const codes = new Set<string>();
  for (const combo of s.combos) {
    for (const group of combo) {
      for (const code of group) codes.add(code);
    }
  }
  setHighlight([...codes]);
}

function comboMatches(combo: string[][], pressed: Set<string>): boolean {
  if (combo.length === 0) return false;
  // Every pressed key must belong to some group (no extras allowed).
  for (const code of pressed) {
    if (!combo.some((g) => g.includes(code))) return false;
  }
  // Every group must be satisfied by at least one pressed key.
  for (const group of combo) {
    if (!group.some((k) => pressed.has(k))) return false;
  }
  return true;
}

function recomputeShortcuts() {
  const pressed = new Set<string>();
  for (const name in keyboard) {
    if (keyboard[name].pressed) pressed.add(name);
  }
  for (const id in shortcuts) {
    const s = shortcuts[id];
    const isActive = s.combos.some((c) => comboMatches(c, pressed));
    if (s.active !== isActive) setShortcuts(id, 'active', isActive);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    const name = e.code;
    if (keyboard[name] && !keyboard[name].pressed) {
      setKeyboard(name, 'pressed', true);
      recomputeShortcuts();
    }
  });
  window.addEventListener('keyup', (e) => {
    const name = e.code;
    if (keyboard[name]?.pressed) {
      setKeyboard(name, 'pressed', false);
      recomputeShortcuts();
    }
  });
}

function KeyRect(props: { def: KeyDef }) {
  const isHighlighted = () => keyboard[props.def.name].highlighted;
  const isPressed = () => keyboard[props.def.name].pressed;

  function getSolid() {
    if (isPressed() && isHighlighted()) {return 'var(--a0)'}
    if (isPressed()) { return 'var(--c4)'};
    if (isHighlighted()) return 'oklch(from var(--a0) l c h / 0.4)';
    return 'var(--b4)';
  };

  function getTransparent() {
    if (isPressed() && isHighlighted()) {return 'oklch(from var(--a0) l c h / 0.6'}
    if (isPressed()) { return 'oklch(from var(--c4) l c h / 0.5)' };
    if (isHighlighted()) return 'oklch(from var(--a0) l c h / 0.2)';
    return 'oklch(from var(--b2) l c h / 0.2';
  };

  return (
    <>
      <rect
        style={{
          'fill': getTransparent(),
          'stroke': getSolid(),
        }}
        height={props.def.height}
        width={props.def.width}
        x={props.def.x}
        y={props.def.y}
        ry="0.2"
      />
      <text
        style={{
          'font-family': 'var(--font-mono)',
          'dominant-baseline': 'central',
          'text-anchor': 'middle',
          'fill': getSolid(),
          'font-size': '0.4',
          'stroke': 'none',
        }}
        x={props.def.labelX}
        y={props.def.labelY}
      >
        {props.def.label}
      </text>
    </>
  );
};

export function Keyboard(): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      style={{
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
        'stroke-width': '0.0572',
        'display': 'block',
        'width': '100%',
        'fill': 'none',
      }}
      viewBox="0 0 29 12"
    >
      <For each={KEYS}>
        {(key) => <KeyRect def={key} />}
      </For>
    </svg>
  );
}
