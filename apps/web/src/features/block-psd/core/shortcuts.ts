/**
 * Photoshop's keyboard shortcuts, as editor commands. ⌘ is Ctrl off
 * macOS. Keys the editor does not use (⌘K, ⌘S, …) stay the app's.
 */

/** Editor commands that shortcuts and menus run. */
export type Command =
  | 'undo'
  | 'redo'
  | 'zoomFit'
  | 'zoom100'
  | 'zoomIn'
  | 'zoomOut'
  | 'selectAll'
  | 'deselect'
  | 'invertSelection'
  | 'featherSelection'
  | 'copy'
  | 'copyMerged'
  | 'cut'
  | 'layerViaCopy'
  | 'layerViaCut'
  | 'freeTransform'
  | 'mergeDown'
  | 'group'
  | 'ungroup'
  | 'newLayer'
  | 'clippingMask'
  | 'delete'
  | 'fillForeground'
  | 'fillBackground'
  | 'swapColors'
  | 'defaultColors'
  | 'brushSmaller'
  | 'brushLarger'
  | 'brushSofter'
  | 'brushHarder'
  | 'commit'
  | 'cancel'
  | 'shortcuts';

export type KeyAction =
  | { t: 'command'; command: Command }
  /** A tool letter (Shift cycles through its group). */
  | { t: 'tool'; key: string; cycle: boolean }
  | { t: 'nudge'; dx: number; dy: number }
  /** A digit: opacity in tenths (0 is 100%). */
  | { t: 'opacity'; value: number };

export interface KeyLike {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

const command = (c: Command): KeyAction => ({ t: 'command', command: c });

const TOOL_LETTERS = new Set('VMLWCIBEGTUHZ'.split(''));

/** ⌘ with a letter. */
const MOD_KEYS: Partial<Record<string, Command>> = {
  A: 'selectAll',
  D: 'deselect',
  C: 'copy',
  X: 'cut',
  J: 'layerViaCopy',
  T: 'freeTransform',
  E: 'mergeDown',
  G: 'group',
};

/** ⇧⌘ with a letter. */
const SHIFT_MOD_KEYS: Partial<Record<string, Command>> = {
  I: 'invertSelection',
  C: 'copyMerged',
  J: 'layerViaCut',
  G: 'ungroup',
  N: 'newLayer',
};

/** The action a key press asks for, if the editor uses it. */
export function keyAction(e: KeyLike, mac: boolean): KeyAction | undefined {
  const mod = mac ? e.metaKey : e.ctrlKey;
  // The other system modifier (Ctrl on a Mac) is not the editor's.
  if (mac ? e.ctrlKey : e.metaKey) return undefined;
  const letter = e.code.startsWith('Key') ? e.code.slice(3) : undefined;
  if (mod) {
    if (e.code === 'KeyZ') return command(e.shiftKey ? 'redo' : 'undo');
    if (!mac && e.code === 'KeyY' && !e.shiftKey) return command('redo');
    if (e.code === 'Digit0' && !e.shiftKey) return command('zoomFit');
    if (e.code === 'Digit1' && !e.shiftKey) return command('zoom100');
    if (e.code === 'Equal' || e.code === 'NumpadAdd' || e.key === '+')
      return command('zoomIn');
    if (e.code === 'Minus' || e.code === 'NumpadSubtract')
      return command('zoomOut');
    if (e.altKey) {
      if (e.code === 'KeyG' && !e.shiftKey) return command('clippingMask');
      return undefined;
    }
    if (e.code === 'Backspace' || e.code === 'Delete')
      return command('fillBackground');
    if (e.code === 'Slash') return command('shortcuts');
    const found = letter && (e.shiftKey ? SHIFT_MOD_KEYS : MOD_KEYS)[letter];
    return found ? command(found) : undefined;
  }
  if (e.code === 'F6' && e.shiftKey) return command('featherSelection');
  if (e.code === 'Backspace' || e.code === 'Delete')
    return command(e.altKey ? 'fillForeground' : 'delete');
  if (e.key === 'Enter') return command('commit');
  if (e.key === 'Escape') return command('cancel');
  const arrows: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };
  const arrow = arrows[e.key];
  if (arrow) {
    const step = e.shiftKey ? 10 : 1;
    return { t: 'nudge', dx: arrow[0] * step, dy: arrow[1] * step };
  }
  if (e.altKey) return undefined;
  if (e.code === 'BracketLeft')
    return command(e.shiftKey ? 'brushSofter' : 'brushSmaller');
  if (e.code === 'BracketRight')
    return command(e.shiftKey ? 'brushHarder' : 'brushLarger');
  if (!e.shiftKey && /^Digit[0-9]$/.test(e.code))
    return { t: 'opacity', value: Number(e.code.slice(5)) };
  if (letter === 'X' && !e.shiftKey) return command('swapColors');
  if (letter === 'D' && !e.shiftKey) return command('defaultColors');
  if (letter && TOOL_LETTERS.has(letter))
    return { t: 'tool', key: letter, cycle: e.shiftKey };
  return undefined;
}

/** Commands that change the document (not offered to viewers). */
export const EDIT_COMMANDS: ReadonlySet<Command> = new Set<Command>([
  'undo',
  'redo',
  'cut',
  'layerViaCopy',
  'layerViaCut',
  'freeTransform',
  'mergeDown',
  'group',
  'ungroup',
  'newLayer',
  'clippingMask',
  'delete',
  'fillForeground',
  'fillBackground',
]);

/** Brush sizes `[` and `]` step through, as Photoshop's do. */
export function stepBrushSize(size: number, direction: 1 | -1): number {
  const step =
    size < 10 ? 1 : size < 100 ? 10 : size < 200 ? 25 : size < 300 ? 50 : 100;
  const next = direction > 0 ? size + step : size - (size <= 10 ? 1 : step);
  return Math.min(5000, Math.max(1, Math.round(next)));
}

/** The groups and keys the shortcuts dialog lists. */
export const SHORTCUT_GROUPS: {
  title: string;
  items: { action: string; keys: string[] }[];
}[] = [
  {
    title: 'Tools',
    items: [
      { action: 'Move', keys: ['V'] },
      { action: 'Marquee (⇧ cycles)', keys: ['M'] },
      { action: 'Lasso (⇧ cycles)', keys: ['L'] },
      { action: 'Magic Wand', keys: ['W'] },
      { action: 'Crop', keys: ['C'] },
      { action: 'Eyedropper', keys: ['I'] },
      { action: 'Brush / Pencil', keys: ['B'] },
      { action: 'Eraser', keys: ['E'] },
      { action: 'Gradient / Paint Bucket', keys: ['G'] },
      { action: 'Type', keys: ['T'] },
      { action: 'Shapes', keys: ['U'] },
      { action: 'Hand (or hold Space)', keys: ['H'] },
      { action: 'Zoom', keys: ['Z'] },
    ],
  },
  {
    title: 'Edit',
    items: [
      { action: 'Undo', keys: ['mod', 'Z'] },
      { action: 'Redo', keys: ['⇧', 'mod', 'Z'] },
      { action: 'Free Transform', keys: ['mod', 'T'] },
      { action: 'Copy / Copy Merged', keys: ['mod', '(⇧)', 'C'] },
      { action: 'Cut', keys: ['mod', 'X'] },
      { action: 'Layer via Copy / Cut', keys: ['mod', '(⇧)', 'J'] },
      { action: 'Fill with foreground', keys: ['⌥', '⌫'] },
      { action: 'Fill with background', keys: ['mod', '⌫'] },
      { action: 'Clear / delete layer', keys: ['⌫'] },
      { action: 'Swap / reset colors', keys: ['X', 'D'] },
      { action: 'Brush size', keys: ['[', ']'] },
      { action: 'Brush hardness', keys: ['⇧', '[', ']'] },
      { action: 'Opacity', keys: ['1…0'] },
    ],
  },
  {
    title: 'Select, layers, and view',
    items: [
      { action: 'Select all / deselect', keys: ['mod', 'A', 'D'] },
      { action: 'Inverse', keys: ['⇧', 'mod', 'I'] },
      { action: 'Feather', keys: ['⇧', 'F6'] },
      { action: 'New layer', keys: ['⇧', 'mod', 'N'] },
      { action: 'Group / ungroup', keys: ['mod', '(⇧)', 'G'] },
      { action: 'Merge down', keys: ['mod', 'E'] },
      { action: 'Clipping mask', keys: ['⌥', 'mod', 'G'] },
      { action: 'Fit on screen', keys: ['mod', '0'] },
      { action: '100%', keys: ['mod', '1'] },
      { action: 'Zoom in / out', keys: ['mod', '+', '−'] },
    ],
  },
];
