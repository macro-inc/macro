import type { Droppable } from '@thisbeyond/solid-dnd';
import { describe, expect, it } from 'vitest';
import { findKanbanCollision } from './kanban-collision';

const viewport = new DOMRect(0, 0, 600, 400);
const source = { data: { kind: 'card', itemId: 'moving', laneId: 'source' } };

function lane(id: string, left: number): Droppable {
  const node = document.createElement('div');
  node.getBoundingClientRect = () => new DOMRect(left, 0, 200, 400);
  const rect = node.getBoundingClientRect();
  const layout = {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom,
    rect,
    center: { x: left + 100, y: 200 },
    corners: {
      topLeft: { x: left, y: 0 },
      topRight: { x: left + 200, y: 0 },
      bottomLeft: { x: left, y: 400 },
      bottomRight: { x: left + 200, y: 400 },
    },
  };
  return {
    id,
    node,
    data: { laneId: id },
    layout,
    transformed: layout,
    transform: { x: 0, y: 0 },
    transformers: {},
  };
}

function card(destination: Droppable, id: string, top: number, nextId = '') {
  const layout = document.createElement('div');
  layout.dataset.kanbanCardLayout = '';
  layout.dataset.kanbanNextId = nextId;
  layout.getBoundingClientRect = () => new DOMRect(220, top, 200, 100);
  const node = document.createElement('div');
  node.dataset.kanbanCard = id;
  layout.append(node);
  destination.node.append(layout);
  return layout;
}

const options = {
  mode: 'cross-column',
  pointerPlacement: true,
  viewport,
} as const;

describe('Kanban collision geometry', () => {
  it('uses layout midpoints and retains the next unmounted card as the insertion anchor', () => {
    const destination = lane('destination', 220);
    card(destination, 'first', 0);
    card(destination, 'second', 100, 'offscreen');

    expect(
      findKanbanCollision(source, [destination], { x: 240, y: 120 }, options)
        ?.drop
    ).toMatchObject({ toLane: 'destination', beforeId: 'second' });
    expect(
      findKanbanCollision(source, [destination], { x: 240, y: 190 }, options)
        ?.drop
    ).toMatchObject({ toLane: 'destination', beforeId: 'offscreen' });
  });

  it('keeps the insertion anchor while hovering the space opened by its placeholder', () => {
    const destination = lane('destination', 220);
    const layout = card(destination, 'first', 100);
    const placeholder = document.createElement('div');
    placeholder.dataset.kanbanPlaceholder = '';
    placeholder.dataset.kanbanBeforeId = 'first';
    layout.replaceChildren(placeholder);

    expect(
      findKanbanCollision(source, [destination], { x: 240, y: 190 }, options)
        ?.drop
    ).toMatchObject({ beforeId: 'first' });
  });

  it('rejects gaps and off-viewport drops without changing ordered-mode gap selection', () => {
    const lanes = [lane('source', 0), lane('destination', 220)];
    expect(
      findKanbanCollision(source, lanes, { x: 210, y: 120 }, options)
    ).toBeNull();
    expect(
      findKanbanCollision(source, lanes, { x: 240, y: 410 }, options)
    ).toBeNull();
    expect(
      findKanbanCollision(
        source,
        lanes,
        { x: 215, y: 120 },
        { mode: 'ordered', viewport }
      )?.drop
    ).toMatchObject({ toLane: 'destination' });
  });
});
