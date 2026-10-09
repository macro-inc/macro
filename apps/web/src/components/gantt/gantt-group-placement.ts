import type { GanttGroupMove } from './gantt-group-drag';

export type GanttGroupPlacement = { index: number; replace?: boolean };

/** Group membership stays consumer-owned; insertion follows the consumer's existing sort. */
export function ganttGroupPlacement<T, E extends { id: string }>(options: {
  items: readonly T[];
  move: GanttGroupMove;
  getEntity: (item: T) => E | undefined;
  getGroup: (item: T) => string | undefined;
  compare: (left: E, right: E) => number;
}): GanttGroupPlacement | undefined {
  const { items, move, getEntity, getGroup, compare } = options;
  const source = items.map(getEntity).find((entity) => entity?.id === move.id);
  if (!source) return;
  const existing = items.findIndex(
    (item) => getGroup(item) === move.toGroup && getEntity(item)?.id === move.id
  );
  if (existing >= 0) return { index: existing, replace: true };
  const first = items.findIndex((item) => getGroup(item) === move.toGroup);
  if (first < 0) return;
  let index = first;
  for (
    ;
    index < items.length && getGroup(items[index]) === move.toGroup;
    index++
  ) {
    const entity = getEntity(items[index]);
    if (entity && compare(source, entity) < 0) break;
    // A continuation stays after the ghost rather than separating the group from its preview.
    if (!entity && index > first) break;
  }
  return { index };
}
