/**
 * Illustrator's keyboard shortcuts, as the editor runs them. ⌘ on a Mac is
 * Ctrl elsewhere; keys are matched by position (`code`) so they work on
 * any keyboard layout.
 */

import type { Tool } from './tools';

export type EditorAction =
  | `tool-${Tool}`
  | 'undo'
  | 'redo'
  | 'group'
  | 'ungroup'
  | 'make-clip'
  | 'release-clip'
  | 'bring-forward'
  | 'send-backward'
  | 'bring-to-front'
  | 'send-to-back'
  | 'duplicate'
  | 'delete'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'select-all'
  | 'deselect'
  | 'toggle-outline'
  | 'create-outlines'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-fit'
  | 'zoom-fit-all'
  | 'zoom-100'
  | 'default-colors'
  | 'swap-colors'
  | 'escape'
  | 'enter'
  | 'nudge-left'
  | 'nudge-right'
  | 'nudge-up'
  | 'nudge-down'
  | 'nudge-left-10'
  | 'nudge-right-10'
  | 'nudge-up-10'
  | 'nudge-down-10';

export interface KeyInput {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const TOOL_KEYS: Record<string, Tool> = {
  KeyV: 'select',
  KeyA: 'direct',
  KeyP: 'pen',
  KeyM: 'rectangle',
  KeyL: 'ellipse',
  Backslash: 'line',
  KeyT: 'type',
  KeyI: 'eyedropper',
  KeyH: 'hand',
  KeyZ: 'zoom',
};

const ARROWS: Record<string, 'left' | 'right' | 'up' | 'down'> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

/** ⌘ shortcuts with a ⇧ or ⌥ variant. */
const COMMAND_VARIANTS: Record<
  string,
  { plain: EditorAction; shift?: EditorAction; alt?: EditorAction }
> = {
  KeyZ: { plain: 'undo', shift: 'redo' },
  KeyG: { plain: 'group', shift: 'ungroup' },
  Digit7: { plain: 'make-clip', alt: 'release-clip' },
  BracketRight: { plain: 'bring-forward', shift: 'bring-to-front' },
  BracketLeft: { plain: 'send-backward', shift: 'send-to-back' },
  Digit0: { plain: 'zoom-fit', alt: 'zoom-fit-all' },
};

/** ⌘ zoom keys, which many layouts type with ⇧. */
const ZOOM_KEYS: Record<string, EditorAction> = {
  Equal: 'zoom-in',
  NumpadAdd: 'zoom-in',
  Minus: 'zoom-out',
  NumpadSubtract: 'zoom-out',
};

/** ⌘ shortcuts without other modifiers. */
const COMMAND_KEYS: Record<string, EditorAction> = {
  KeyD: 'duplicate',
  KeyC: 'copy',
  KeyX: 'cut',
  KeyV: 'paste',
  KeyA: 'select-all',
  KeyY: 'toggle-outline',
  Digit1: 'zoom-100',
};

/** Shortcuts with ⌘ (Ctrl), by key and the other modifiers. */
function commandAction(e: KeyInput): EditorAction | undefined {
  const { code, shiftKey: shift, altKey: alt } = e;
  const variants = COMMAND_VARIANTS[code];
  if (variants) {
    if (alt && variants.alt) return variants.alt;
    if (shift && variants.shift) return variants.shift;
    return variants.plain;
  }
  if (code === 'KeyO' && shift) return 'create-outlines';
  if (alt) return undefined;
  const zoom = ZOOM_KEYS[code];
  if (zoom) return zoom;
  if (shift) return code === 'KeyA' ? 'deselect' : undefined;
  return COMMAND_KEYS[code];
}

/** The action a key press runs, if any. */
export function shortcutAction(
  e: KeyInput,
  mac: boolean
): EditorAction | undefined {
  const mod = mac ? e.metaKey : e.ctrlKey;
  const other = mac ? e.ctrlKey : e.metaKey;
  if (other) return undefined;
  if (mod) return commandAction(e);
  const arrow = ARROWS[e.key];
  if (arrow) {
    if (e.altKey) return undefined;
    return e.shiftKey ? `nudge-${arrow}-10` : `nudge-${arrow}`;
  }
  if (e.altKey) return undefined;
  if (e.key === 'Escape') return 'escape';
  if (e.key === 'Enter') return 'enter';
  if (e.key === 'Backspace' || e.key === 'Delete') return 'delete';
  if (e.shiftKey) {
    if (e.code === 'KeyO') return 'tool-artboard';
    if (e.code === 'KeyX') return 'swap-colors';
    return undefined;
  }
  if (e.code === 'KeyD') return 'default-colors';
  const tool = TOOL_KEYS[e.code];
  return tool ? `tool-${tool}` : undefined;
}

/** Actions that change the document (not offered read-only). */
export const EDIT_ACTIONS: ReadonlySet<EditorAction> = new Set<EditorAction>([
  'tool-pen',
  'tool-rectangle',
  'tool-ellipse',
  'tool-polygon',
  'tool-star',
  'tool-line',
  'tool-type',
  'tool-eyedropper',
  'tool-artboard',
  'undo',
  'redo',
  'group',
  'ungroup',
  'make-clip',
  'release-clip',
  'bring-forward',
  'send-backward',
  'bring-to-front',
  'send-to-back',
  'duplicate',
  'delete',
  'cut',
  'paste',
  'create-outlines',
  'nudge-left',
  'nudge-right',
  'nudge-up',
  'nudge-down',
  'nudge-left-10',
  'nudge-right-10',
  'nudge-up-10',
  'nudge-down-10',
]);

/**
 * Actions on the selection: with nothing selected the key is left to the
 * app (⇧← focuses the split to the left, say).
 */
export const SELECTION_ACTIONS: ReadonlySet<EditorAction> =
  new Set<EditorAction>([
    'group',
    'ungroup',
    'make-clip',
    'release-clip',
    'bring-forward',
    'send-backward',
    'bring-to-front',
    'send-to-back',
    'duplicate',
    'copy',
    'cut',
    'create-outlines',
    'nudge-left',
    'nudge-right',
    'nudge-up',
    'nudge-down',
    'nudge-left-10',
    'nudge-right-10',
    'nudge-up-10',
    'nudge-down-10',
  ]);

/** The offset an arrow-key nudge moves by (points). */
export function nudgeOffset(
  action: EditorAction
): { dx: number; dy: number } | undefined {
  const m = /^nudge-(left|right|up|down)(-10)?$/.exec(action);
  if (!m) return undefined;
  const step = m[2] ? 10 : 1;
  const dx = m[1] === 'left' ? -step : m[1] === 'right' ? step : 0;
  const dy = m[1] === 'up' ? -step : m[1] === 'down' ? step : 0;
  return { dx, dy };
}

/** A shortcut as the menus show it on this platform. */
export function keyLabel(keys: string, mac: boolean): string {
  if (mac) return keys;
  return keys
    .replace(/⇧/g, 'Shift+')
    .replace(/⌥/g, 'Alt+')
    .replace(/⌘/g, 'Ctrl+');
}
