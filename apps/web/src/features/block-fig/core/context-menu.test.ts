import { describe, expect, it } from 'vitest';
import {
  canvasMenu,
  layerMenu,
  type MenuEntry,
  type MenuItem,
  type SelectionFacts,
  shortcutLabel,
} from './context-menu';
import { shortcutAction } from './shortcuts';

const facts = (over: Partial<SelectionFacts> = {}): SelectionFacts => ({
  count: 1,
  canEdit: true,
  structural: true,
  canPaste: false,
  anyVisible: true,
  anyUnlocked: true,
  types: ['RECTANGLE'],
  hasAutoLayout: false,
  ...over,
});

const items = (entries: MenuEntry[]) =>
  entries.filter((e): e is MenuItem => e !== 'separator');
const labels = (entries: MenuEntry[]) => items(entries).map((e) => e.label);
const item = (entries: MenuEntry[], label: string) =>
  items(entries).find((e) => e.label === label);

describe('layer context menu', () => {
  it("lists Figma's layer actions with their shortcuts", () => {
    const menu = layerMenu(facts());
    expect(labels(menu)).toEqual([
      'Copy',
      'Paste here',
      'Paste to replace',
      'Copy as PNG',
      'Bring to front',
      'Bring forward',
      'Send backward',
      'Send to back',
      'Group selection',
      'Frame selection',
      'Add auto layout',
      'Create component',
      'Hide',
      'Lock',
      'Flip horizontal',
      'Flip vertical',
      'Rename',
      'Delete',
    ]);
    expect(item(menu, 'Bring to front')?.shortcut).toBe('⌥⌘]');
    expect(item(menu, 'Paste here')?.disabled).toBe(true);
    expect(menu[0]).not.toBe('separator');
    expect(menu.at(-1)).not.toBe('separator');
  });

  it('adapts to what is selected', () => {
    const frame = layerMenu(
      facts({
        types: ['FRAME'],
        hasAutoLayout: true,
        anyVisible: false,
        anyUnlocked: false,
        canPaste: true,
      })
    );
    expect(labels(frame)).toContain('Ungroup');
    expect(labels(frame)).toContain('Remove auto layout');
    expect(labels(frame)).toContain('Show');
    expect(labels(frame)).toContain('Unlock');
    expect(item(frame, 'Paste to replace')?.disabled).toBe(false);

    const instance = layerMenu(facts({ types: ['INSTANCE'] }));
    expect(labels(instance)).toContain('Detach instance');
    const component = layerMenu(facts({ types: ['SYMBOL'] }));
    expect(labels(component)).not.toContain('Create component');
    expect(labels(component)).toContain('Combine as variants');
    expect(labels(instance)).not.toContain('Combine as variants');
    const several = layerMenu(facts({ count: 2 }));
    expect(labels(several)).not.toContain('Rename');
  });

  it('disables moving layers inside instances', () => {
    const menu = layerMenu(facts({ structural: false }));
    expect(item(menu, 'Delete')?.disabled).toBe(true);
    expect(item(menu, 'Group selection')?.disabled).toBe(true);
    expect(item(menu, 'Hide')?.disabled).toBeFalsy();
  });

  it('offers only viewing actions when read-only', () => {
    expect(labels(layerMenu(facts({ canEdit: false })))).toEqual([
      'Copy',
      'Copy as PNG',
      'Zoom to selection',
    ]);
  });
});

describe('canvas context menu', () => {
  it('pastes, toggles the view, and zooms', () => {
    const menu = canvasMenu({
      canEdit: true,
      canPaste: true,
      uiHidden: false,
      rulers: true,
      pixelGrid: false,
      outline: false,
    });
    expect(labels(menu)).toEqual([
      'Paste here',
      'Hide UI',
      'Rulers',
      'Pixel grid',
      'Outline view',
      'Zoom in',
      'Zoom out',
      'Zoom to fit',
      'Zoom to 100%',
      'Select all',
    ]);
    expect(item(menu, 'Rulers')?.checked).toBe(true);
    const readOnly = canvasMenu({
      canEdit: false,
      canPaste: false,
      uiHidden: true,
      rulers: false,
      pixelGrid: true,
      outline: false,
    });
    expect(labels(readOnly)[0]).toBe('Show UI');
  });
});

describe('shortcut labels', () => {
  it('writes shortcuts for the platform', () => {
    expect(shortcutLabel('⌥⌘G', true)).toBe('⌥⌘G');
    expect(shortcutLabel('⌥⌘G', false)).toBe('Ctrl+Alt+G');
    expect(shortcutLabel('⇧⌘H', false)).toBe('Ctrl+Shift+H');
    expect(shortcutLabel('⇧H', false)).toBe('Shift+H');
    expect(shortcutLabel('⌫', false)).toBe('Delete');
  });

  it('flips with ⇧H and ⇧V', () => {
    const shift = (key: string, code: string) => ({
      key,
      code,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: true,
    });
    expect(shortcutAction(shift('H', 'KeyH'), true)).toBe('flip-horizontal');
    expect(shortcutAction(shift('V', 'KeyV'), false)).toBe('flip-vertical');
  });
});
