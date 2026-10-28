import type {
  ShapeOutline,
  SmartArtCatalog,
  SmartArtOutline,
} from '@core/pptx-engine/types';
import { describe, expect, it } from 'vitest';
import {
  canDemote,
  canPromote,
  colorGroups,
  layoutsIn,
  newNodeId,
  nodeAt,
  type PaneLine,
  paneEdit,
  paneKey,
  paneLines,
  shortId,
} from './smartart';

const outline = (nodes: [string, string, number][]): SmartArtOutline => ({
  layout: {
    id: 'urn:microsoft.com/office/officeart/2005/8/layout/vList2',
    name: 'Vertical Bullet List',
    supported: true,
  },
  colors: 'urn:microsoft.com/office/officeart/2005/8/colors/accent1_2',
  style: 'urn:microsoft.com/office/officeart/2005/8/quickstyle/simple1',
  nodes: nodes.map(([id, text, level]) => ({ id, text, level })),
});

const lines: PaneLine[] = paneLines(
  outline([
    ['a', 'Plan', 1],
    ['a1', 'Scope', 2],
    ['b', 'Build', 1],
    ['b1', 'Code', 2],
    ['b2', 'Test', 2],
  ])
);

const key = (k: string, shift = false) => ({ key: k, shift });
const at = (n: number) => ({ start: n, end: n });

describe('text pane lines', () => {
  it('lists one line per node with its level', () => {
    expect(lines.map((l) => `${l.text}:${l.level}`)).toEqual([
      'Plan:1',
      'Scope:2',
      'Build:1',
      'Code:2',
      'Test:2',
    ]);
    expect(paneLines(outline([['x', 'two\nparas', 1]]))[0].text).toBe(
      'two paras'
    );
  });

  it('demotes only after an earlier sibling and promotes below the top', () => {
    expect(canDemote(lines, 0)).toBe(false);
    expect(canDemote(lines, 1)).toBe(false);
    expect(canDemote(lines, 2)).toBe(true);
    expect(canDemote(lines, 3)).toBe(false);
    expect(canDemote(lines, 4)).toBe(true);
    expect(canPromote(lines, 0)).toBe(false);
    expect(canPromote(lines, 3)).toBe(true);
  });
});

describe('text pane keys', () => {
  it('Enter splits the bullet at the caret into a new node', () => {
    const action = paneKey(lines, 2, key('Enter'), 'Build', at(3));
    expect(action).toEqual({
      kind: 'split',
      node: 'b',
      before: 'Bui',
      after: 'ld',
    });
    expect(paneEdit(action)).toEqual({
      action: 'addNode',
      node: 'b',
      position: 'after',
      text: 'ld',
    });
    expect(paneKey(lines, 2, key('Enter', true), 'Build', at(3)).kind).toBe(
      'none'
    );
  });

  it('Tab demotes and Shift+Tab promotes when they can', () => {
    expect(paneKey(lines, 2, key('Tab'), 'Build', at(0))).toEqual({
      kind: 'demote',
      node: 'b',
    });
    expect(paneKey(lines, 0, key('Tab'), 'Plan', at(0)).kind).toBe('none');
    expect(paneKey(lines, 3, key('Tab', true), 'Code', at(0))).toEqual({
      kind: 'promote',
      node: 'b1',
    });
    expect(paneKey(lines, 2, key('Tab', true), 'Build', at(0)).kind).toBe(
      'none'
    );
  });

  it('Backspace deletes an empty bullet and moves up, or outdents at the start', () => {
    expect(paneKey(lines, 3, key('Backspace'), '', at(0))).toEqual({
      kind: 'delete',
      node: 'b1',
      focus: 'b',
    });
    expect(paneEdit({ kind: 'delete', node: 'b1' })).toEqual({
      action: 'deleteNode',
      node: 'b1',
    });
    expect(paneKey(lines, 4, key('Backspace'), 'Test', at(0))).toEqual({
      kind: 'promote',
      node: 'b2',
    });
    expect(paneKey(lines, 4, key('Backspace'), 'Test', at(2)).kind).toBe(
      'none'
    );
    // The last bullet stays.
    const one = paneLines(outline([['only', '', 1]]));
    expect(paneKey(one, 0, key('Backspace'), '', at(0)).kind).toBe('none');
  });

  it('arrows move between bullets', () => {
    expect(paneKey(lines, 1, key('ArrowUp'), 'Scope', at(0))).toEqual({
      kind: 'focus',
      node: 'a',
      at: 'end',
    });
    expect(paneKey(lines, 4, key('ArrowDown'), 'Test', at(0)).kind).toBe(
      'none'
    );
  });
});

describe('nodes', () => {
  it('finds the node a new edit created', () => {
    const before = outline([['a', 'A', 1]]);
    const after = outline([
      ['a', 'A', 1],
      ['n', '', 1],
    ]);
    expect(newNodeId(before, after)).toBe('n');
    expect(newNodeId(after, after)).toBeUndefined();
  });

  it('hit-tests node frames, preferring the smallest box', () => {
    const smartArt = outline([
      ['big', 'Back', 1],
      ['small', 'Front', 2],
    ]);
    smartArt.nodes[0].frame = [0, 0, 100, 100];
    smartArt.nodes[1].frame = [20, 20, 30, 30];
    const shape = {
      id: 4,
      x: 100,
      y: 50,
      w: 200,
      h: 200,
      smartArt,
    } as unknown as ShapeOutline;
    expect(nodeAt(shape, { x: 130, y: 80 })?.id).toBe('small');
    expect(nodeAt(shape, { x: 105, y: 55 })?.id).toBe('big');
    expect(nodeAt(shape, { x: 290, y: 240 })).toBeUndefined();
  });
});

describe('galleries', () => {
  const catalog: SmartArtCatalog = {
    layouts: [
      {
        id: 'l/default',
        short: 'default',
        name: 'Basic Block List',
        categories: ['list'],
      },
      {
        id: 'l/radial1',
        short: 'radial1',
        name: 'Basic Radial',
        categories: ['cycle', 'relationship'],
      },
    ],
    colors: [
      {
        id: 'c/accent0_1',
        short: 'accent0_1',
        name: 'Dark 1 Outline',
        category: 'mainScheme',
      },
      {
        id: 'c/colorful1',
        short: 'colorful1',
        name: 'Colorful',
        category: 'colorful',
      },
      {
        id: 'c/accent2_2',
        short: 'accent2_2',
        name: 'Colored Fill - Accent 2',
        category: 'accent2',
      },
    ],
    styles: [],
  };

  it('lists layouts by category', () => {
    expect(layoutsIn(catalog, 'all')).toHaveLength(2);
    expect(layoutsIn(catalog, 'relationship').map((l) => l.short)).toEqual([
      'radial1',
    ]);
    expect(layoutsIn(undefined, 'list')).toEqual([]);
  });

  it('groups color variations like Change Colors', () => {
    expect(colorGroups(catalog).map((g) => g.label)).toEqual([
      'Primary Theme Colors',
      'Colorful',
      'Accent 2',
    ]);
  });

  it('shortens ids', () => {
    expect(
      shortId('urn:microsoft.com/office/officeart/2005/8/layout/process1')
    ).toBe('process1');
  });
});
