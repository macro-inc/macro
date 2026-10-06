/**
 * Figma's keyboard shortcuts for viewing and editing a file, as actions.
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
  | 'toggle-layout-grids'
  | 'toggle-layers'
  | 'toggle-design'
  | 'collapse-layers'
  | 'copy-png'
  | 'export'
  | 'find'
  | 'show-shortcuts'
  | 'open-actions'
  | 'toggle-assets'
  | 'tool-frame'
  | 'tool-rectangle'
  | 'tool-ellipse'
  | 'tool-text'
  | 'tool-line'
  | 'tool-arrow'
  | 'tool-pen'
  | 'tool-pencil'
  | 'place-image'
  | 'undo'
  | 'redo'
  | 'delete'
  | 'duplicate'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'paste-replace'
  | 'group'
  | 'ungroup'
  | 'frame-selection'
  | 'add-auto-layout'
  | 'create-component'
  | 'detach-instance'
  | 'remove-auto-layout'
  | 'boolean-union'
  | 'boolean-subtract'
  | 'boolean-intersect'
  | 'boolean-exclude'
  | 'flatten'
  | 'bring-forward'
  | 'send-backward'
  | 'bring-to-front'
  | 'send-to-back'
  | 'toggle-visible'
  | 'toggle-locked'
  | 'flip-horizontal'
  | 'flip-vertical'
  | 'rename'
  | 'align-left'
  | 'align-center'
  | 'align-right'
  | 'align-top'
  | 'align-middle'
  | 'align-bottom'
  | 'distribute-horizontal'
  | 'distribute-vertical'
  | 'swap-fill-stroke'
  | OpacityAction
  | 'nudge-left'
  | 'nudge-right'
  | 'nudge-up'
  | 'nudge-down'
  | 'nudge-left-10'
  | 'nudge-right-10'
  | 'nudge-up-10'
  | 'nudge-down-10';

type Digit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';

/** Figma's opacity keys: 1 is 10%, 0 is 100%; two quick digits, 45%. */
export type OpacityAction = `opacity-${Digit}`;

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

  // Layout grids: ⌃G on macOS, Ctrl+⇧4 elsewhere (Ctrl+G groups there).
  if (
    mac
      ? e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.code === 'KeyG'
      : e.ctrlKey && e.shiftKey && !e.altKey && e.code === 'Digit4'
  )
    return 'toggle-layout-grids';

  // Distribute: ⌃⌥H / ⌃⌥V (Ctrl+Alt elsewhere, where Ctrl is the modifier).
  if (e.ctrlKey && e.altKey && !e.metaKey && !e.shiftKey) {
    if (e.code === 'KeyH') return 'distribute-horizontal';
    if (e.code === 'KeyV') return 'distribute-vertical';
  }

  if (e.altKey && !mod && !otherMod) {
    if (e.shiftKey) {
      if (e.code === 'KeyA') return 'remove-auto-layout';
      if (e.code === 'KeyU') return 'boolean-union';
      if (e.code === 'KeyS') return 'boolean-subtract';
      if (e.code === 'KeyI') return 'boolean-intersect';
      // ⌥⇧E is Figma's; ⌥⇧X is kept for those used to it here.
      if (e.code === 'KeyE' || e.code === 'KeyX') return 'boolean-exclude';
      return undefined;
    }
    if (e.code === 'Digit1') return 'toggle-layers';
    if (e.code === 'Digit2') return 'toggle-assets';
    if (e.code === 'Digit8') return 'toggle-design';
    if (e.code === 'KeyL') return 'collapse-layers';
    if (e.code === 'KeyA') return 'align-left';
    if (e.code === 'KeyH') return 'align-center';
    if (e.code === 'KeyD') return 'align-right';
    if (e.code === 'KeyW') return 'align-top';
    if (e.code === 'KeyV') return 'align-middle';
    if (e.code === 'KeyS') return 'align-bottom';
    return undefined;
  }

  if (mod && e.altKey) {
    if (e.code === 'KeyG') return 'frame-selection';
    if (e.code === 'KeyK') return 'create-component';
    if (e.code === 'KeyB') return 'detach-instance';
    if (e.code === 'BracketRight') return 'bring-to-front';
    if (e.code === 'BracketLeft') return 'send-to-back';
    return undefined;
  }

  if (mod && !e.altKey) {
    if (e.shiftKey) {
      if (e.code === 'KeyC') return 'copy-png';
      if (e.code === 'KeyE') return 'export';
      if (e.code === 'KeyZ') return 'redo';
      if (e.code === 'KeyG') return 'ungroup';
      if (e.code === 'KeyH') return 'toggle-visible';
      if (e.code === 'KeyL') return 'toggle-locked';
      if (e.code === 'KeyK') return 'place-image';
      if (e.code === 'KeyR') return 'paste-replace';
      return undefined;
    }
    if (e.code === 'KeyZ') return 'undo';
    if (e.code === 'KeyD') return 'duplicate';
    if (e.code === 'KeyE') return 'flatten';
    if (e.code === 'KeyC') return 'copy';
    if (e.code === 'KeyX') return 'cut';
    if (e.code === 'KeyV') return 'paste';
    if (e.code === 'KeyG') return 'group';
    if (e.code === 'KeyR') return 'rename';
    if (e.code === 'BracketRight') return 'bring-forward';
    if (e.code === 'BracketLeft') return 'send-backward';
    if (e.code === 'Equal' || e.code === 'NumpadAdd' || key === '+')
      return 'zoom-in';
    if (e.code === 'Minus' || e.code === 'NumpadSubtract') return 'zoom-out';
    if (e.code === 'Digit0' || e.code === 'Numpad0') return 'zoom-100';
    if (e.code === 'KeyA') return 'select-all';
    // Figma takes both ⌘\ and ⌘. for showing and hiding the UI.
    if (e.code === 'Backslash' || e.code === 'Period') return 'toggle-ui';
    // The actions menu (the browser's print is not used here).
    if (e.code === 'KeyP' || e.code === 'Slash') return 'open-actions';
    if (e.code === 'KeyY') return 'toggle-outline';
    if (e.code === 'KeyF') return 'find';
    return undefined;
  }

  if (!plain) return undefined;

  if (!e.shiftKey && /^Digit[0-9]$/.test(e.code))
    return `opacity-${e.code.slice(5) as Digit}`;

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
      case 'KeyA':
        return 'add-auto-layout';
      case 'KeyH':
        return 'flip-horizontal';
      case 'KeyV':
        return 'flip-vertical';
      case 'KeyL':
        return 'tool-arrow';
      case 'KeyP':
        return 'tool-pencil';
      case 'KeyX':
        return 'swap-fill-stroke';
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
      case 'ArrowLeft':
        return 'nudge-left-10';
      case 'ArrowRight':
        return 'nudge-right-10';
      case 'ArrowUp':
        return 'nudge-up-10';
      case 'ArrowDown':
        return 'nudge-down-10';
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
    case 'f':
    case 'a':
      return 'tool-frame';
    case 'r':
      return 'tool-rectangle';
    case 'o':
      return 'tool-ellipse';
    case 't':
      return 'tool-text';
    case 'l':
      return 'tool-line';
    case 'p':
      return 'tool-pen';
    case 'Delete':
    case 'Backspace':
      return 'delete';
    case 'ArrowLeft':
      return 'nudge-left';
    case 'ArrowRight':
      return 'nudge-right';
    case 'ArrowUp':
      return 'nudge-up';
    case 'ArrowDown':
      return 'nudge-down';
  }
  return undefined;
}

/** Actions that change the file (ignored when it is read-only). */
export const EDIT_ACTIONS: ReadonlySet<ViewerAction> = new Set<ViewerAction>([
  'tool-frame',
  'tool-rectangle',
  'tool-ellipse',
  'tool-text',
  'tool-line',
  'tool-arrow',
  'tool-pen',
  'tool-pencil',
  'place-image',
  'undo',
  'redo',
  'delete',
  'duplicate',
  'cut',
  'paste',
  'paste-replace',
  'group',
  'ungroup',
  'frame-selection',
  'add-auto-layout',
  'remove-auto-layout',
  'boolean-union',
  'boolean-subtract',
  'boolean-intersect',
  'boolean-exclude',
  'flatten',
  'create-component',
  'detach-instance',
  'bring-forward',
  'send-backward',
  'bring-to-front',
  'send-to-back',
  'toggle-visible',
  'toggle-locked',
  'flip-horizontal',
  'flip-vertical',
  'rename',
  'align-left',
  'align-center',
  'align-right',
  'align-top',
  'align-middle',
  'align-bottom',
  'distribute-horizontal',
  'distribute-vertical',
  'swap-fill-stroke',
  'opacity-0',
  'opacity-1',
  'opacity-2',
  'opacity-3',
  'opacity-4',
  'opacity-5',
  'opacity-6',
  'opacity-7',
  'opacity-8',
  'opacity-9',
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
 * Actions that do nothing without a selection: their keys then go on to
 * the app (⇧←/⇧→ focus the next split, ⇧⌘C copies the item's link).
 */
export const SELECTION_ACTIONS: ReadonlySet<ViewerAction> =
  new Set<ViewerAction>([
    'flip-horizontal',
    'flip-vertical',
    'copy-png',
    'nudge-left',
    'nudge-right',
    'nudge-up',
    'nudge-down',
    'nudge-left-10',
    'nudge-right-10',
    'nudge-up-10',
    'nudge-down-10',
  ]);

export interface ShortcutHelp {
  action: string;
  /** Key caps; `mod` is ⌘ on macOS and Ctrl elsewhere. */
  keys: string[];
  /** Keys elsewhere, when they differ by more than ⌘ for Ctrl. */
  otherKeys?: string[];
  /** What it runs, for the actions menu (absent for gestures). */
  id?: ViewerAction;
}

/** The shortcuts panel, grouped; the actions menu lists the same. */
export const SHORTCUT_GROUPS: { title: string; items: ShortcutHelp[] }[] = [
  {
    title: 'Tools',
    items: [
      { action: 'Move', keys: ['V'], id: 'tool-move' },
      { action: 'Frame', keys: ['F'], id: 'tool-frame' },
      { action: 'Rectangle', keys: ['R'], id: 'tool-rectangle' },
      { action: 'Ellipse', keys: ['O'], id: 'tool-ellipse' },
      { action: 'Line', keys: ['L'], id: 'tool-line' },
      { action: 'Arrow', keys: ['⇧', 'L'], id: 'tool-arrow' },
      { action: 'Text', keys: ['T'], id: 'tool-text' },
      { action: 'Pen', keys: ['P'], id: 'tool-pen' },
      { action: 'Pencil', keys: ['⇧', 'P'], id: 'tool-pencil' },
      { action: 'Place image', keys: ['mod', '⇧', 'K'], id: 'place-image' },
      { action: 'Hand (pan)', keys: ['H'], id: 'tool-hand' },
      { action: 'Pan while held', keys: ['Space'] },
    ],
  },
  {
    title: 'Edit',
    items: [
      { action: 'Undo', keys: ['mod', 'Z'], id: 'undo' },
      { action: 'Redo', keys: ['mod', '⇧', 'Z'], id: 'redo' },
      { action: 'Duplicate', keys: ['mod', 'D'], id: 'duplicate' },
      { action: 'Copy', keys: ['mod', 'C'], id: 'copy' },
      { action: 'Cut', keys: ['mod', 'X'], id: 'cut' },
      { action: 'Paste (across files)', keys: ['mod', 'V'] },
      {
        action: 'Paste to replace',
        keys: ['mod', '⇧', 'R'],
        id: 'paste-replace',
      },
      { action: 'Delete', keys: ['⌫'], id: 'delete' },
      { action: 'Nudge', keys: ['←↑→↓'] },
      { action: 'Nudge 10', keys: ['⇧', '←↑→↓'] },
      { action: 'Rename', keys: ['mod', 'R'], id: 'rename' },
    ],
  },
  {
    title: 'Arrange',
    items: [
      { action: 'Group', keys: ['mod', 'G'], id: 'group' },
      { action: 'Ungroup', keys: ['mod', '⇧', 'G'], id: 'ungroup' },
      {
        action: 'Frame selection',
        keys: ['mod', '⌥', 'G'],
        id: 'frame-selection',
      },
      { action: 'Add auto layout', keys: ['⇧', 'A'], id: 'add-auto-layout' },
      {
        action: 'Remove auto layout',
        keys: ['⌥', '⇧', 'A'],
        id: 'remove-auto-layout',
      },
      {
        action: 'Create component',
        keys: ['mod', '⌥', 'K'],
        id: 'create-component',
      },
      {
        action: 'Detach instance',
        keys: ['mod', '⌥', 'B'],
        id: 'detach-instance',
      },
      { action: 'Bring forward', keys: ['mod', ']'], id: 'bring-forward' },
      { action: 'Send backward', keys: ['mod', '['], id: 'send-backward' },
      {
        action: 'Bring to front',
        keys: ['mod', '⌥', ']'],
        id: 'bring-to-front',
      },
      { action: 'Send to back', keys: ['mod', '⌥', '['], id: 'send-to-back' },
      { action: 'Show/hide', keys: ['mod', '⇧', 'H'], id: 'toggle-visible' },
      { action: 'Lock/unlock', keys: ['mod', '⇧', 'L'], id: 'toggle-locked' },
      { action: 'Flip horizontal', keys: ['⇧', 'H'], id: 'flip-horizontal' },
      { action: 'Flip vertical', keys: ['⇧', 'V'], id: 'flip-vertical' },
    ],
  },
  {
    title: 'Align',
    items: [
      { action: 'Align left', keys: ['⌥', 'A'], id: 'align-left' },
      {
        action: 'Align horizontal centers',
        keys: ['⌥', 'H'],
        id: 'align-center',
      },
      { action: 'Align right', keys: ['⌥', 'D'], id: 'align-right' },
      { action: 'Align top', keys: ['⌥', 'W'], id: 'align-top' },
      {
        action: 'Align vertical centers',
        keys: ['⌥', 'V'],
        id: 'align-middle',
      },
      { action: 'Align bottom', keys: ['⌥', 'S'], id: 'align-bottom' },
      {
        action: 'Distribute horizontal spacing',
        keys: ['⌃', '⌥', 'H'],
        otherKeys: ['Ctrl', 'Alt', 'H'],
        id: 'distribute-horizontal',
      },
      {
        action: 'Distribute vertical spacing',
        keys: ['⌃', '⌥', 'V'],
        otherKeys: ['Ctrl', 'Alt', 'V'],
        id: 'distribute-vertical',
      },
    ],
  },
  {
    title: 'Shapes',
    items: [
      { action: 'Union', keys: ['⌥', '⇧', 'U'], id: 'boolean-union' },
      { action: 'Subtract', keys: ['⌥', '⇧', 'S'], id: 'boolean-subtract' },
      { action: 'Intersect', keys: ['⌥', '⇧', 'I'], id: 'boolean-intersect' },
      { action: 'Exclude', keys: ['⌥', '⇧', 'E'], id: 'boolean-exclude' },
      { action: 'Flatten', keys: ['mod', 'E'], id: 'flatten' },
      { action: 'Edit points', keys: ['Enter'] },
    ],
  },
  {
    title: 'Fill and stroke',
    items: [
      { action: 'Opacity 10%–90%', keys: ['1…9'] },
      { action: 'Opacity 100%', keys: ['0'], id: 'opacity-0' },
      { action: 'Opacity, exact (e.g. 45%)', keys: ['4', '5'] },
      {
        action: 'Swap fill and stroke',
        keys: ['⇧', 'X'],
        id: 'swap-fill-stroke',
      },
    ],
  },
  {
    title: 'Zoom',
    items: [
      { action: 'Zoom in', keys: ['mod', '+'], id: 'zoom-in' },
      { action: 'Zoom out', keys: ['mod', '-'], id: 'zoom-out' },
      { action: 'Zoom to 100%', keys: ['⇧', '0'], id: 'zoom-100' },
      { action: 'Zoom to fit', keys: ['⇧', '1'], id: 'zoom-fit' },
      { action: 'Zoom to selection', keys: ['⇧', '2'], id: 'zoom-selection' },
      { action: 'Zoom with scroll', keys: ['mod', 'Scroll'] },
    ],
  },
  {
    title: 'Navigate',
    items: [
      { action: 'Next frame', keys: ['N'], id: 'next-frame' },
      { action: 'Previous frame', keys: ['⇧', 'N'], id: 'previous-frame' },
      { action: 'Next page', keys: ['PgDn'], id: 'next-page' },
      { action: 'Previous page', keys: ['PgUp'], id: 'previous-page' },
      { action: 'Find layers', keys: ['mod', 'F'], id: 'find' },
    ],
  },
  {
    title: 'Selection',
    items: [
      { action: 'Select all', keys: ['mod', 'A'], id: 'select-all' },
      { action: 'Deep select', keys: ['mod', 'Click'] },
      { action: 'Select children', keys: ['Enter'], id: 'select-children' },
      { action: 'Select parent', keys: ['⇧', 'Enter'], id: 'select-parent' },
      { action: 'Next sibling', keys: ['Tab'], id: 'next-sibling' },
      {
        action: 'Previous sibling',
        keys: ['⇧', 'Tab'],
        id: 'previous-sibling',
      },
      { action: 'Deselect / parent', keys: ['Esc'] },
      { action: 'Measure to layer', keys: ['⌥', 'Hover'] },
    ],
  },
  {
    title: 'View',
    items: [
      { action: 'Actions', keys: ['mod', 'P'], id: 'open-actions' },
      { action: 'Show/hide UI', keys: ['mod', '.'], id: 'toggle-ui' },
      { action: 'Outline view', keys: ['mod', 'Y'], id: 'toggle-outline' },
      { action: 'Rulers', keys: ['⇧', 'R'], id: 'toggle-rulers' },
      { action: 'Pixel grid', keys: ['⇧', "'"], id: 'toggle-pixel-grid' },
      {
        action: 'Layout grids',
        keys: ['⌃', 'G'],
        otherKeys: ['Ctrl', '⇧', '4'],
        id: 'toggle-layout-grids',
      },
      { action: 'Layers panel', keys: ['⌥', '1'], id: 'toggle-layers' },
      { action: 'Assets panel', keys: ['⌥', '2'], id: 'toggle-assets' },
      { action: 'Design panel', keys: ['⌥', '8'], id: 'toggle-design' },
      { action: 'Collapse layers', keys: ['⌥', 'L'], id: 'collapse-layers' },
    ],
  },
  {
    title: 'Review',
    items: [
      { action: 'Comment', keys: ['C'] },
      { action: 'Present', keys: ['mod', '⌥', '↵'] },
    ],
  },
  {
    title: 'Export',
    items: [
      { action: 'Copy as PNG', keys: ['mod', '⇧', 'C'], id: 'copy-png' },
      { action: 'Export selection', keys: ['mod', '⇧', 'E'], id: 'export' },
      {
        action: 'Keyboard shortcuts',
        keys: ['Ctrl', '⇧', '?'],
        id: 'show-shortcuts',
      },
    ],
  },
];

/**
 * Whether a key commits a text field: Enter, except while an input method
 * is composing (Enter then confirms the composition).
 */
export function isCommitKey(e: {
  key: string;
  isComposing: boolean;
  keyCode: number;
}): boolean {
  return e.key === 'Enter' && !e.isComposing && e.keyCode !== 229;
}

/**
 * Whether a focused control uses a key itself, so it is not a canvas
 * shortcut: selects take their keys (arrows, typing), buttons and links
 * Space and Enter. Shortcuts with ⌘/Ctrl still apply.
 */
export function controlOwnsKey(
  tag: string,
  e: Pick<KeyInput, 'key' | 'metaKey' | 'ctrlKey'>
): boolean {
  if (e.metaKey || e.ctrlKey) return false;
  if (tag === 'SELECT') return true;
  if (tag === 'BUTTON' || tag === 'A')
    return e.key === ' ' || e.key === 'Enter';
  return false;
}
