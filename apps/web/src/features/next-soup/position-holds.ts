import type { DateValue } from '@core/util/date';
import { type Accessor, createMemo, createSignal } from 'solid-js';

type PositionHold = {
  /** The list scope (filters and sort) the position was captured in. */
  scope: string;
  /** Entity rendered directly above the held one, if any. */
  afterId: string | undefined;
  /** Entity rendered directly below the held one, if any. */
  beforeId: string | undefined;
  /** Sort timestamp at capture, so client date groups keep the row too. */
  sortTs: DateValue | undefined;
};

type HoldableEntity = {
  id: string;
  sortTs?: DateValue | null;
  updatedAt?: DateValue | null;
  createdAt?: DateValue | null;
};

/**
 * Keeps rows where they were when an in-place action changed their sort key,
 * such as discarding a draft, which moves a thread back to its last received
 * message. A hold lasts while the list keeps the scope it was captured in;
 * changing filters or sort releases it.
 */
export function createPositionHolds(options: { scope: Accessor<string> }) {
  const [holds, setHolds] = createSignal<ReadonlyMap<string, PositionHold>>(
    new Map()
  );

  const active = createMemo(() => {
    const scope = options.scope();
    const all = holds();
    const result = new Map<string, PositionHold>();
    for (const [id, hold] of all)
      if (hold.scope === scope) result.set(id, hold);
    return result;
  });

  /** Capture the positions of `ids` in the rendered entity order. */
  const hold = (order: readonly HoldableEntity[], ids: readonly string[]) => {
    const scope = options.scope();
    const next = new Map<string, PositionHold>();
    for (const [id, existing] of holds())
      if (existing.scope === scope) next.set(id, existing);
    const wanted = new Set(ids);
    order.forEach((entity, index) => {
      if (!wanted.has(entity.id)) return;
      next.set(entity.id, {
        scope,
        afterId: order[index - 1]?.id,
        beforeId: order[index + 1]?.id,
        sortTs:
          entity.sortTs ?? entity.updatedAt ?? entity.createdAt ?? undefined,
      });
    });
    setHolds(next);
  };

  /** Move held entities back beside their captured neighbours. */
  const apply = <T extends { id: string }>(entities: T[]): T[] => {
    const current = active();
    if (current.size === 0) return entities;
    const result = [...entities];
    for (const [id, hold] of current) {
      const from = result.findIndex((entity) => entity.id === id);
      if (from < 0) continue;
      const [entity] = result.splice(from, 1);
      const after =
        hold.afterId === undefined
          ? -1
          : result.findIndex((other) => other.id === hold.afterId);
      if (after >= 0) {
        result.splice(after + 1, 0, entity);
        continue;
      }
      const before =
        hold.beforeId === undefined
          ? -1
          : result.findIndex((other) => other.id === hold.beforeId);
      if (before >= 0) {
        result.splice(before, 0, entity);
        continue;
      }
      // Both neighbours are gone; fall back to the natural position.
      result.splice(from, 0, entity);
    }
    return result;
  };

  const sortTs = (id: string): DateValue | undefined =>
    active().get(id)?.sortTs;

  return { hold, apply, sortTs };
}

export type PositionHolds = ReturnType<typeof createPositionHolds>;
