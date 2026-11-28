import { equalQueryValue } from '../../../graphql-cache/exchange/query-shape';
import type { LiveQueryUpdate } from '../../../graphql-cache/protocol';
import type { LiveQueryRow } from './create-predicate-query';

type Patch = LiveQueryUpdate['patches'][number];

/** A copy of `value` with `path` set, sharing every branch the path leaves. */
export function withPath(
  value: unknown,
  path: readonly (string | number)[],
  next: unknown
): unknown {
  if (path.length === 0) return next;
  const [head, ...rest] = path;
  const base = value as Record<string | number, unknown> | unknown[] | null;
  const copy: Record<string | number, unknown> = Array.isArray(base)
    ? ([...base] as unknown as Record<number, unknown>)
    : { ...(base ?? {}) };
  copy[head] = withPath(
    (base as Record<string | number, unknown> | null)?.[head],
    rest,
    next
  );
  return copy;
}

/**
 * A live view's rows as immutable values: an update replaces each row it
 * changes with a new object and keeps every other row as it was, so readers
 * compare rows by identity instead of tracking a store.
 *
 * It keeps the record the host sent beside the row it shows, since patches
 * address the sent record: the shaped row when the host shapes rows, else the
 * selected record, which `toRow` shapes here.
 */
export class ImmutableLiveRows<T> {
  private readonly rows = new Map<
    string,
    { sent: unknown; shaped: boolean; row: LiveQueryRow<T> }
  >();
  private ordered: readonly LiveQueryRow<T>[] = [];
  private keys: readonly string[] = [];

  constructor(private readonly toRow: (record: object, shaped: boolean) => T) {}

  has(recordKey: string): boolean {
    return this.rows.has(recordKey);
  }

  /** Applies a checked update; returns the rows in view order. */
  apply(update: LiveQueryUpdate, shaped: boolean): readonly LiveQueryRow<T>[] {
    let changed =
      update.reset || update.keys !== undefined || update.removed.length > 0;
    // A reset or a repeated upsert often resends a row unchanged: keep its
    // object so readers map it once.
    const before = update.reset ? new Map(this.rows) : this.rows;
    if (update.reset) this.rows.clear();
    for (const key of update.removed) this.rows.delete(key);
    for (const upsert of update.upserts) {
      changed = true;
      const old = before.get(upsert.recordKey);
      if (
        old &&
        old.shaped === shaped &&
        equalQueryValue(old.row.identity, upsert.identity) &&
        equalQueryValue(old.sent, upsert.record)
      ) {
        this.rows.set(upsert.recordKey, old);
        continue;
      }
      this.rows.set(upsert.recordKey, {
        sent: upsert.record,
        shaped,
        row: {
          recordKey: upsert.recordKey,
          record: this.toRow(upsert.record as object, shaped),
          ...(upsert.identity ? { identity: upsert.identity } : {}),
        },
      });
    }
    for (const patch of update.patches) {
      changed = true;
      this.patch(patch, shaped);
    }
    if (update.keys !== undefined) this.keys = update.keys;
    if (changed)
      this.ordered = this.keys.flatMap((key) => {
        const entry = this.rows.get(key);
        return entry ? [entry.row] : [];
      });
    return this.ordered;
  }

  private patch(patch: Patch, shaped: boolean): void {
    const entry = this.rows.get(patch.recordKey);
    if (!entry) throw new Error('live query patch has no base row');
    let sent = entry.sent;
    for (const field of patch.fields)
      sent = withPath(sent, field.path, field.value);
    this.rows.set(patch.recordKey, {
      sent,
      shaped,
      row: {
        recordKey: patch.recordKey,
        record: this.toRow(sent as object, shaped),
        identity: patch.identity,
      },
    });
  }
}
