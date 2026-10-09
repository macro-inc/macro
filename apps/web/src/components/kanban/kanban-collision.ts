import type { Draggable, Droppable } from '@thisbeyond/solid-dnd';
import type { KanbanDrop } from './kanban-types';

export const LANE_INSERTION_INSET = 10;

type Point = { x: number; y: number };

type MeasuredLane = {
  droppable: Droppable;
  rect: DOMRect;
};

type DropLocation = {
  id: string;
  fromLane: string;
  toLane: string;
};

type CollisionOptions = {
  mode: 'ordered' | 'cross-column';
  viewport?: DOMRect;
  pointerPlacement?: boolean;
};

type KanbanCollision = {
  drop: KanbanDrop;
  droppable: Droppable;
};

function isOutside(value: number, start: number, end: number) {
  return value < start || value > end;
}

function findClosestLane(
  lanes: MeasuredLane[],
  pointer: Point,
  viewport?: DOMRect
) {
  if (lanes.length === 0) {
    return undefined;
  }

  const left = lanes[0].rect.left;
  const right = lanes[lanes.length - 1].rect.right;

  if (isOutside(pointer.x, left, right)) {
    return undefined;
  }

  if (!viewport) {
    const top = Math.min(...lanes.map((lane) => lane.rect.top));
    const bottom = Math.max(...lanes.map((lane) => lane.rect.bottom));

    if (isOutside(pointer.y, top, bottom)) {
      return undefined;
    }
  }

  return lanes.reduce((closest, lane) => {
    const center = lane.rect.left + lane.rect.width / 2;
    const closestCenter = closest.rect.left + closest.rect.width / 2;
    const distance = Math.abs(pointer.x - center);
    const closestDistance = Math.abs(pointer.x - closestCenter);

    if (distance < closestDistance) {
      return lane;
    }

    return closest;
  });
}

function getLaneDrop(
  location: DropLocation,
  lane: MeasuredLane,
  lanes: MeasuredLane[],
  pointerX: number,
  viewport?: DOMRect
): KanbanDrop | undefined {
  const { fromLane, toLane } = location;

  if (fromLane === toLane) {
    return undefined;
  }

  const center = lane.rect.left + lane.rect.width / 2;
  const edge = pointerX < center ? 'before' : 'after';
  const boundary =
    edge === 'before'
      ? lane.rect.left - LANE_INSERTION_INSET
      : lane.rect.right + LANE_INSERTION_INSET;

  if (viewport && isOutside(boundary, viewport.left, viewport.right)) {
    return undefined;
  }

  const originalIndex = lanes.findIndex(
    (lane) => lane.droppable.data.laneId === fromLane
  );

  if (originalIndex < 0) {
    return undefined;
  }

  const remaining = lanes.filter(
    (lane) => lane.droppable.data.laneId !== fromLane
  );
  const destinationIndex = remaining.findIndex(
    (lane) => lane.droppable.data.laneId === toLane
  );
  const insertionIndex = destinationIndex + (edge === 'after' ? 1 : 0);

  if (insertionIndex === originalIndex) {
    return undefined;
  }

  return { kind: 'lane', ...location, edge };
}

function getCardDrop(
  location: DropLocation,
  lane: MeasuredLane,
  pointerY: number,
  pointerPlacement = false
): KanbanDrop | undefined {
  const { id, fromLane, toLane } = location;
  if (pointerPlacement) {
    const placeholder = lane.droppable.node.querySelector<HTMLElement>(
      '[data-kanban-placeholder]'
    );
    const bounds = placeholder?.parentElement?.getBoundingClientRect();

    if (
      placeholder &&
      bounds &&
      pointerY >= bounds.top &&
      pointerY <= bounds.bottom
    ) {
      return {
        kind: 'card',
        ...location,
        beforeId: placeholder.dataset.kanbanBeforeId || undefined,
      };
    }
  }
  const cards = Array.from(
    lane.droppable.node.querySelectorAll<HTMLElement>('[data-kanban-card]')
  );
  const remaining = cards.filter((card) => card.dataset.kanbanCard !== id);
  const next = remaining.find((card) => {
    const layout = pointerPlacement
      ? card.closest<HTMLElement>('[data-kanban-card-layout]')
      : undefined;
    const bounds = (layout ?? card).getBoundingClientRect();

    return pointerY < bounds.top + bounds.height / 2;
  });

  if (fromLane === toLane) {
    const insertionIndex = next ? remaining.indexOf(next) : remaining.length;
    const originalIndex = cards.findIndex(
      (card) => card.dataset.kanbanCard === id
    );

    if (insertionIndex === originalIndex) {
      return undefined;
    }
  }

  const last = remaining.at(-1);
  const nextId = pointerPlacement
    ? last?.closest<HTMLElement>('[data-kanban-card-layout]')?.dataset
        .kanbanNextId
    : undefined;
  return {
    kind: 'card',
    ...location,
    beforeId: next?.dataset.kanbanCard ?? (nextId || undefined),
  };
}

/** Measures the current DOM so scrolling never leaves stale collision targets. */
export function findKanbanCollision(
  draggable: Pick<Draggable, 'data'>,
  droppables: Droppable[],
  pointer: Point,
  options: CollisionOptions
): KanbanCollision | null {
  const { mode, viewport } = options;

  if (viewport) {
    const outsideX = isOutside(pointer.x, viewport.left, viewport.right);
    const outsideY = isOutside(pointer.y, viewport.top, viewport.bottom);

    if (outsideX || outsideY) {
      return null;
    }
  }

  const lanes = droppables
    .map((droppable) => ({
      droppable,
      rect: droppable.node.getBoundingClientRect(),
    }))
    .sort((a, b) => a.rect.left - b.rect.left);
  const lane = findClosestLane(lanes, pointer, viewport);

  if (!lane) {
    return null;
  }

  if (mode === 'cross-column') {
    const outsideX = isOutside(pointer.x, lane.rect.left, lane.rect.right);
    const outsideY = isOutside(pointer.y, lane.rect.top, lane.rect.bottom);

    if (outsideX || outsideY) {
      return null;
    }
  }

  const { kind, itemId: id, laneId: fromLane } = draggable.data;
  const toLane: unknown = lane.droppable.data.laneId;
  const validSource = typeof id === 'string' && typeof fromLane === 'string';

  if (!validSource || typeof toLane !== 'string') {
    return null;
  }

  const location = { id, fromLane, toLane };

  if (kind === 'lane') {
    if (mode === 'cross-column') {
      return null;
    }

    const drop = getLaneDrop(location, lane, lanes, pointer.x, viewport);

    return drop ? { drop, droppable: lane.droppable } : null;
  }

  if (kind !== 'card') {
    return null;
  }

  const drop: KanbanDrop | undefined =
    mode === 'cross-column' && !options.pointerPlacement
      ? { kind: 'card', ...location }
      : getCardDrop(location, lane, pointer.y, options.pointerPlacement);

  return drop ? { drop, droppable: lane.droppable } : null;
}
