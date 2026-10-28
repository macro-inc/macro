import type { LayerRow, NodeType } from '@core/fig-engine/types';
import { describe, expect, it } from 'vitest';
import { clickTarget, doubleClickTarget } from './selection';

const row = (id: string, type: NodeType): LayerRow => ({
  id,
  name: id,
  type,
  visible: true,
  locked: false,
  childCount: 0,
  isMask: false,
  inInstance: false,
});

const chain = [
  row('frame', 'FRAME'),
  row('card', 'FRAME'),
  row('group', 'GROUP'),
  row('text', 'TEXT'),
];

describe('click selection', () => {
  it('selects a top-level frame’s child directly', () => {
    expect(clickTarget(chain, { selected: [] }, false)?.id).toBe('card');
  });

  it('selects the frame itself on its empty area', () => {
    expect(clickTarget([chain[0]], { selected: [] }, false)?.id).toBe('frame');
  });

  it('selects a top-level group as a unit', () => {
    const groups = [row('g', 'GROUP'), row('shape', 'RECTANGLE')];
    expect(clickTarget(groups, { selected: [] }, false)?.id).toBe('g');
  });

  it('looks through sections', () => {
    const sectioned = [row('s', 'SECTION'), ...chain];
    expect(clickTarget(sectioned, { selected: [] }, false)?.id).toBe('card');
  });

  it('deep selects the deepest layer', () => {
    expect(clickTarget(chain, { selected: [] }, true)?.id).toBe('text');
  });

  it('stays at the depth of the current selection', () => {
    const selected = [{ id: 'other', parent: 'card' }];
    expect(clickTarget(chain, { selected }, false)?.id).toBe('group');
    const same = [{ id: 'group', parent: 'card' }];
    expect(clickTarget(chain, { selected: same }, false)?.id).toBe('group');
  });

  it('double click goes one level deeper', () => {
    const selected = [{ id: 'card', parent: 'frame' }];
    expect(doubleClickTarget(chain, { selected })?.id).toBe('group');
    expect(doubleClickTarget(chain, { selected: [] })?.id).toBe('group');
  });
});
