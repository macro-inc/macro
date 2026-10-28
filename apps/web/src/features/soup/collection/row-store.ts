import { createKeyedProjection } from '@app/lib/queries/soup/create-keyed-projection';
import type { Accessor } from 'solid-js';

/** Stable row identity, with independent tracking and reconciliation per row. */
export function createSoupRowStore<TRow extends { id: string }>(
  rows: Accessor<TRow[]>
): Accessor<TRow[]> {
  return createKeyedProjection(
    rows,
    (row) => row.id,
    (row) => row
  );
}
