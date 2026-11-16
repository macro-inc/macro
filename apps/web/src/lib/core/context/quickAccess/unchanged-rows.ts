import { deepEqual } from '@core/util/compareUtils';

/**
 * Sources rebuild their rows on every cache refresh and page read, and readers
 * tell lists apart by identity. Hand back the earlier object for each row whose
 * data did not change, and the earlier list itself when no row changed or moved.
 */
export function keepUnchangedRows<T extends { id: string }>(
  previous: T[],
  next: T[]
): T[] {
  const previousById = new Map(previous.map((row) => [row.id, row]));
  let changed = previous.length !== next.length;

  const rows = next.map((row, index) => {
    const earlier = previousById.get(row.id);
    const kept =
      earlier !== undefined && deepEqual(earlier, row) ? earlier : row;
    if (kept !== previous[index]) changed = true;
    return kept;
  });

  return changed ? rows : previous;
}
