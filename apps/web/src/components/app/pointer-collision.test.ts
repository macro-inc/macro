import type { CollisionDetector } from '@thisbeyond/solid-dnd';
import { describe, expect, it, vi } from 'vitest';
import { createPointerCollisionDetector } from './pointer-collision';

type Draggable = Parameters<CollisionDetector>[0];
type Droppable = Parameters<CollisionDetector>[1][number];
function item(node: HTMLElement, id: string, dndScope?: string): Droppable {
  const layout = {
    x: 999,
    y: 999,
    width: 1,
    height: 1,
    left: 999,
    top: 999,
    right: 1000,
    bottom: 1000,
    rect: { x: 999, y: 999, width: 1, height: 1 },
    center: { x: 999.5, y: 999.5 },
    corners: {
      topLeft: { x: 999, y: 999 },
      topRight: { x: 1000, y: 999 },
      bottomRight: { x: 1000, y: 1000 },
      bottomLeft: { x: 999, y: 1000 },
    },
  };
  return {
    id,
    node,
    data: { dndScope },
    layout,
    transformers: {},
    transform: { x: 0, y: 0 },
    transformed: layout,
  };
}
const context = { activeDroppableId: null };

describe('pointer collision', () => {
  it('uses the innermost visible target regardless of stale cached bounds', () => {
    const list = document.createElement('div');
    const row = document.createElement('div');
    const name = document.createElement('span');
    list.append(row);
    row.append(name);
    const source = item(
      document.createElement('div'),
      'source',
      'rail'
    ) as Draggable;
    const targets = [item(list, 'list', 'rail'), item(row, 'row', 'rail')];
    const hit = vi.fn(() => name);
    const detector = createPointerCollisionDetector(
      () => ({ x: 50, y: 75 }),
      hit
    );
    expect(detector(source, targets, context)?.id).toBe('row');
    expect(hit).toHaveBeenCalledWith(50, 75);
  });

  it('ignores clipped or covered targets and follows scroll changes', () => {
    const list = document.createElement('div');
    const row = document.createElement('div');
    list.append(row);
    const source = item(row, 'source') as Draggable;
    const targets = [item(list, 'list'), item(row, 'row')];
    let visible: Element = row;
    const detector = createPointerCollisionDetector(
      () => ({ x: 10, y: 20 }),
      () => visible
    );
    expect(detector(source, targets, context)?.id).toBe('row');
    visible = list;
    expect(detector(source, targets, context)?.id).toBe('list');
    visible = document.createElement('div');
    expect(detector(source, targets, context)).toBeNull();
  });

  it('isolates drag scopes and skips disabled targets', () => {
    const row = document.createElement('div');
    const source = item(row, 'source', 'first') as Draggable;
    const target = item(row, 'target', 'second');
    const detector = createPointerCollisionDetector(
      () => ({ x: 0, y: 0 }),
      () => row
    );
    expect(detector(source, [target], context)).toBeNull();
    target.data.dndScope = 'first';
    target.data.isDropTargetDisabled = () => true;
    expect(detector(source, [target], context)).toBeNull();
    target.data.isDropTargetDisabled = () => false;
    expect(detector(source, [target], context)?.id).toBe('target');
  });
});
