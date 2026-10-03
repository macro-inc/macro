import type { TableChanges } from '@service-storage/generated/schemas/tableChanges';

/** Past this many changed rows, one read of the table costs less than reading each. */
export const MAX_INCREMENTAL_ROWS = 300;

/** The engine's most row ids in one `row_id IN (...)` read before it reads the table whole. */
export const MAX_KEY_HINT_VALUES = 100;

/** How a table read held at one version catches up with a later one. */
export type RefreshPlan =
  /** Read the table whole. */
  | { kind: 'full' }
  /** Read the written rows again and forget the removed ones; the fold reruns over them. */
  | {
      kind: 'rows';
      written: string[];
      removed: string[];
      /** The version the read reaches. */
      version: number;
    };

/**
 * Plan catching up to `version` from what changed since. A column change reshapes every row, a
 * gap leaves changes unknown, and an added row may belong anywhere in a page; each reads the
 * table whole, as does a journal that has not reached `version` or too many changed rows.
 */
export function refreshPlan(
  changes: TableChanges,
  version: number
): RefreshPlan {
  if (
    !changes.complete ||
    changes.truncated ||
    changes.columns.length > 0 ||
    changes.version < version ||
    changes.rows.length > MAX_INCREMENTAL_ROWS ||
    changes.rows.some((row) => row.kind === 'insert')
  )
    return { kind: 'full' };
  return {
    kind: 'rows',
    written: changes.rows
      .filter((row) => row.kind === 'update')
      .map(({ row }) => row),
    removed: changes.rows
      .filter((row) => row.kind === 'delete')
      .map(({ row }) => row),
    version: changes.version,
  };
}

/** Ids in reads the engine narrows to `row_id IN (...)`, each at most {@link MAX_KEY_HINT_VALUES} long. */
export function keyHintChunks(ids: readonly string[]): string[][] {
  const chunks: string[][] = [];
  for (let start = 0; start < ids.length; start += MAX_KEY_HINT_VALUES)
    chunks.push(ids.slice(start, start + MAX_KEY_HINT_VALUES));
  return chunks;
}
