/**
 * The canvas context menu, as Figma builds it: on layers (the canvas or a
 * layers panel row) the clipboard, arrangement, grouping, component,
 * visibility, and transform actions for the selection; on empty canvas,
 * pasting, the UI, and zoom. Items show their shortcut keys.
 */

import type { ViewerAction } from './shortcuts';

/** Menu-only actions, besides the shortcut actions. */
export type MenuAction =
  | ViewerAction
  | 'paste-here'
  | 'paste-replace'
  | 'combine-as-variants';

export interface MenuItem {
  action: MenuAction;
  label: string;
  /** Shortcut as macOS writes it (`⇧⌘H`); see `shortcutLabel`. */
  shortcut?: string;
  disabled?: boolean;
  /** A view toggle that is on. */
  checked?: boolean;
}

export type MenuEntry = MenuItem | 'separator';

/** What the menu needs to know about the selection. */
export interface SelectionFacts {
  count: number;
  /** The file is editable. */
  canEdit: boolean;
  /** Some selected layer is outside an instance (can move, group, …). */
  structural: boolean;
  /** Layers copied in this file can be pasted. */
  canPaste: boolean;
  /** Some selected layer is visible (so the action hides). */
  anyVisible: boolean;
  /** Some selected layer is unlocked (so the action locks). */
  anyUnlocked: boolean;
  /** Layer types of the selection (`FRAME`, `INSTANCE`, …). */
  types: string[];
  /** The selection is one frame that has auto layout. */
  hasAutoLayout: boolean;
}

/** View state the empty-canvas menu shows. */
export interface ViewFacts {
  canEdit: boolean;
  canPaste: boolean;
  uiHidden: boolean;
  rulers: boolean;
  pixelGrid: boolean;
  outline: boolean;
}

const MODIFIERS: Record<string, string> = {
  '⌃': 'Ctrl',
  '⌥': 'Alt',
  '⇧': 'Shift',
  '⌘': 'Ctrl',
};

/**
 * A shortcut for the platform: macOS symbols as written, elsewhere
 * `Ctrl+Alt+Shift+K` (⌘ is Ctrl there).
 */
export function shortcutLabel(mac: string, isMac: boolean): string {
  if (isMac) return mac;
  const mods = [...mac].filter((c) => c in MODIFIERS).map((c) => MODIFIERS[c]);
  const key = [...mac].filter((c) => !(c in MODIFIERS)).join('');
  const order = ['Ctrl', 'Alt', 'Shift'];
  const sorted = [...new Set(mods)].sort(
    (a, b) => order.indexOf(a) - order.indexOf(b)
  );
  return [...sorted, key === '⌫' ? 'Delete' : key].join('+');
}

const UNGROUPABLE = ['GROUP', 'FRAME', 'BOOLEAN_OPERATION', 'SECTION'];

/** Drops separators at the ends and doubled ones. */
function tidy(entries: (MenuEntry | false | undefined)[]): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const e of entries) {
    if (!e) continue;
    if (e === 'separator' && (out.length === 0 || out.at(-1) === 'separator'))
      continue;
    out.push(e);
  }
  if (out.at(-1) === 'separator') out.pop();
  return out;
}

/** Clipboard actions: copy, paste here or to replace, copy as PNG. */
function clipboardItems(f: SelectionFacts, move: boolean): MenuItem[] {
  const copy: MenuItem = {
    action: 'copy',
    label: 'Copy',
    shortcut: '⌘C',
    disabled: !move,
  };
  const png: MenuItem = {
    action: 'copy-png',
    label: 'Copy as PNG',
    shortcut: '⇧⌘C',
  };
  if (!f.canEdit) return [copy, png];
  return [
    copy,
    { action: 'paste-here', label: 'Paste here', disabled: !f.canPaste },
    {
      action: 'paste-replace',
      label: 'Paste to replace',
      disabled: !f.canPaste || !f.structural,
    },
    png,
  ];
}

/** Grouping, auto layout, and component actions. */
function structureItems(f: SelectionFacts): MenuEntry[] {
  const ungroupable = f.types.some((t) => UNGROUPABLE.includes(t));
  const component = f.count === 1 && f.types[0] === 'SYMBOL';
  return tidy([
    { action: 'group', label: 'Group selection', shortcut: '⌘G' },
    ungroupable && { action: 'ungroup', label: 'Ungroup', shortcut: '⇧⌘G' },
    {
      action: 'frame-selection',
      label: 'Frame selection',
      shortcut: '⌥⌘G',
    },
    'separator',
    f.hasAutoLayout
      ? {
          action: 'remove-auto-layout',
          label: 'Remove auto layout',
          shortcut: '⌥⇧A',
        }
      : { action: 'add-auto-layout', label: 'Add auto layout', shortcut: '⇧A' },
    !component && {
      action: 'create-component',
      label: 'Create component',
      shortcut: '⌥⌘K',
    },
    f.types.length > 0 &&
      f.types.every((t) => t === 'SYMBOL') && {
        action: 'combine-as-variants',
        label: 'Combine as variants',
      },
    f.types.includes('INSTANCE') && {
      action: 'detach-instance',
      label: 'Detach instance',
      shortcut: '⌥⌘B',
    },
  ]);
}

/** Items that move layers, disabled for layers inside instances. */
const movable = (entries: MenuEntry[], move: boolean): MenuEntry[] =>
  entries.map((e) =>
    e === 'separator' || move ? e : { ...e, disabled: true }
  );

/** The menu for a right-click on selected layers. */
export function layerMenu(f: SelectionFacts): MenuEntry[] {
  const move = f.canEdit && f.structural;
  if (!f.canEdit)
    return [
      ...clipboardItems(f, move),
      'separator',
      { action: 'zoom-selection', label: 'Zoom to selection', shortcut: '⇧2' },
    ];
  return tidy([
    ...clipboardItems(f, move),
    'separator',
    ...movable(
      [
        { action: 'bring-to-front', label: 'Bring to front', shortcut: '⌥⌘]' },
        { action: 'bring-forward', label: 'Bring forward', shortcut: '⌘]' },
        { action: 'send-backward', label: 'Send backward', shortcut: '⌘[' },
        { action: 'send-to-back', label: 'Send to back', shortcut: '⌥⌘[' },
        'separator',
        ...structureItems(f),
      ],
      move
    ),
    'separator',
    {
      action: 'toggle-visible',
      label: f.anyVisible ? 'Hide' : 'Show',
      shortcut: '⇧⌘H',
    },
    {
      action: 'toggle-locked',
      label: f.anyUnlocked ? 'Lock' : 'Unlock',
      shortcut: '⇧⌘L',
    },
    'separator',
    ...movable(
      [
        { action: 'flip-horizontal', label: 'Flip horizontal', shortcut: '⇧H' },
        { action: 'flip-vertical', label: 'Flip vertical', shortcut: '⇧V' },
      ],
      move
    ),
    'separator',
    f.count === 1 && {
      action: 'rename',
      label: 'Rename',
      shortcut: '⌘R',
      disabled: !f.structural,
    },
    { action: 'delete', label: 'Delete', shortcut: '⌫', disabled: !move },
  ]);
}

/** The menu for a right-click on empty canvas. */
export function canvasMenu(f: ViewFacts): MenuEntry[] {
  return tidy([
    f.canEdit && {
      action: 'paste-here',
      label: 'Paste here',
      disabled: !f.canPaste,
    },
    'separator',
    {
      action: 'toggle-ui',
      label: f.uiHidden ? 'Show UI' : 'Hide UI',
      shortcut: '⌘\\',
    },
    {
      action: 'toggle-rulers',
      label: 'Rulers',
      shortcut: '⇧R',
      checked: f.rulers,
    },
    {
      action: 'toggle-pixel-grid',
      label: 'Pixel grid',
      shortcut: "⇧'",
      checked: f.pixelGrid,
    },
    {
      action: 'toggle-outline',
      label: 'Outline view',
      shortcut: '⌘Y',
      checked: f.outline,
    },
    'separator',
    { action: 'zoom-in', label: 'Zoom in', shortcut: '⌘+' },
    { action: 'zoom-out', label: 'Zoom out', shortcut: '⌘-' },
    { action: 'zoom-fit', label: 'Zoom to fit', shortcut: '⇧1' },
    { action: 'zoom-100', label: 'Zoom to 100%', shortcut: '⇧0' },
    'separator',
    f.canEdit && { action: 'select-all', label: 'Select all', shortcut: '⌘A' },
  ]);
}
