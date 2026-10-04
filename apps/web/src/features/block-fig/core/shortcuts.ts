/**
 * Figma's keyboard shortcuts for viewing a file, as viewer actions.
 *
 * Digits are matched by physical key (`Digit1`) so ⇧1 works whatever the
 * shifted character is on the keyboard layout.
 */

export type ViewerAction =
  | 'tool-move'
  | 'tool-hand'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-100'
  | 'zoom-fit'
  | 'zoom-selection'
  | 'next-frame'
  | 'previous-frame'
  | 'next-page'
  | 'previous-page'
  | 'select-all'
  | 'escape'
  | 'select-parent'
  | 'select-children'
  | 'next-sibling'
  | 'previous-sibling'
  | 'toggle-ui'
  | 'toggle-outline'
  | 'toggle-rulers'
  | 'toggle-pixel-grid'
  | 'toggle-layers'
  | 'toggle-design'
  | 'collapse-layers'
  | 'copy-png'
  | 'export'
  | 'find'
  | 'show-shortcuts';

export interface KeyInput {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** The action for a key press, if it is one of the viewer's shortcuts. */
export function shortcutAction(
  e: KeyInput,
  mac: boolean
): ViewerAction | undefined {
  const mod = mac ? e.metaKey : e.ctrlKey;
  // On macOS, Ctrl is never the command modifier.
  const otherMod = mac ? e.ctrlKey : e.metaKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const plain = !mod && !otherMod && !e.altKey;

  // Ctrl+⇧+? (Figma's shortcut for the shortcuts panel), on any platform.
  if (e.ctrlKey && e.shiftKey && (key === '?' || e.code === 'Slash'))
    return 'show-shortcuts';

  if (e.altKey && !mod && !otherMod) {
    if (e.code === 'Digit1') return 'toggle-layers';
    if (e.code === 'Digit8') return 'toggle-design';
    if (e.code === 'KeyL') return 'collapse-layers';
    return undefined;
  }

  if (mod && !e.altKey) {
    if (e.shiftKey) {
      if (e.code === 'KeyC') return 'copy-png';
      if (e.code === 'KeyE') return 'export';
      return undefined;
    }
    if (e.code === 'Equal' || e.code === 'NumpadAdd' || key === '+')
      return 'zoom-in';
    if (e.code === 'Minus' || e.code === 'NumpadSubtract') return 'zoom-out';
    if (e.code === 'Digit0' || e.code === 'Numpad0') return 'zoom-100';
    if (e.code === 'KeyA') return 'select-all';
    if (e.code === 'Backslash') return 'toggle-ui';
    if (e.code === 'KeyY') return 'toggle-outline';
    if (e.code === 'KeyF') return 'find';
    return undefined;
  }

  if (!plain) return undefined;

  if (e.shiftKey) {
    switch (e.code) {
      case 'Digit0':
        return 'zoom-100';
      case 'Digit1':
        return 'zoom-fit';
      case 'Digit2':
        return 'zoom-selection';
      case 'KeyN':
        return 'previous-frame';
      case 'KeyR':
        return 'toggle-rulers';
      case 'Quote':
        return 'toggle-pixel-grid';
      case 'Tab':
        return 'previous-sibling';
      case 'Enter':
        return 'select-parent';
      case 'Equal':
        return 'zoom-in';
      case 'Slash':
        return 'show-shortcuts';
    }
    if (key === '?') return 'show-shortcuts';
    if (key === '+') return 'zoom-in';
    return undefined;
  }

  switch (key) {
    case 'v':
      return 'tool-move';
    case 'h':
      return 'tool-hand';
    case 'n':
      return 'next-frame';
    case '=':
    case '+':
      return 'zoom-in';
    case '-':
      return 'zoom-out';
    case 'Escape':
      return 'escape';
    case 'Enter':
      return 'select-children';
    case '\\':
      return 'select-parent';
    case 'Tab':
      return 'next-sibling';
    case 'PageDown':
      return 'next-page';
    case 'PageUp':
      return 'previous-page';
  }
  return undefined;
}

export interface ShortcutHelp {
  action: string;
  /** Key caps; `mod` is ⌘ on macOS and Ctrl elsewhere. */
  keys: string[];
}

/** The shortcuts panel, grouped. */
export const SHORTCUT_GROUPS: { title: string; items: ShortcutHelp[] }[] = [
  {
    title: 'Tools',
    items: [
      { action: 'Move', keys: ['V'] },
      { action: 'Hand (pan)', keys: ['H'] },
      { action: 'Pan while held', keys: ['Space'] },
    ],
  },
  {
    title: 'Zoom',
    items: [
      { action: 'Zoom in', keys: ['mod', '+'] },
      { action: 'Zoom out', keys: ['mod', '-'] },
      { action: 'Zoom to 100%', keys: ['⇧', '0'] },
      { action: 'Zoom to fit', keys: ['⇧', '1'] },
      { action: 'Zoom to selection', keys: ['⇧', '2'] },
      { action: 'Zoom with scroll', keys: ['mod', 'Scroll'] },
    ],
  },
  {
    title: 'Navigate',
    items: [
      { action: 'Next frame', keys: ['N'] },
      { action: 'Previous frame', keys: ['⇧', 'N'] },
      { action: 'Next page', keys: ['PgDn'] },
      { action: 'Previous page', keys: ['PgUp'] },
      { action: 'Find layers', keys: ['mod', 'F'] },
    ],
  },
  {
    title: 'Selection',
    items: [
      { action: 'Select all', keys: ['mod', 'A'] },
      { action: 'Deep select', keys: ['mod', 'Click'] },
      { action: 'Select children', keys: ['Enter'] },
      { action: 'Select parent', keys: ['⇧', 'Enter'] },
      { action: 'Next sibling', keys: ['Tab'] },
      { action: 'Previous sibling', keys: ['⇧', 'Tab'] },
      { action: 'Deselect / parent', keys: ['Esc'] },
      { action: 'Measure to layer', keys: ['⌥', 'Hover'] },
    ],
  },
  {
    title: 'View',
    items: [
      { action: 'Show/hide UI', keys: ['mod', '\\'] },
      { action: 'Outline view', keys: ['mod', 'Y'] },
      { action: 'Rulers', keys: ['⇧', 'R'] },
      { action: 'Pixel grid', keys: ['⇧', "'"] },
      { action: 'Layers panel', keys: ['⌥', '1'] },
      { action: 'Design panel', keys: ['⌥', '8'] },
      { action: 'Collapse layers', keys: ['⌥', 'L'] },
    ],
  },
  {
    title: 'Export',
    items: [
      { action: 'Copy as PNG', keys: ['mod', '⇧', 'C'] },
      { action: 'Export selection', keys: ['mod', '⇧', 'E'] },
      { action: 'Keyboard shortcuts', keys: ['Ctrl', '⇧', '?'] },
    ],
  },
];
