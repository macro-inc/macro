// What a list shows, reduced to what its caller renders and decides with:
// which rows, in which order, under which notification time and name. Used
// to decide when a live list has caught up, and to compare live and reload
// reads of both sides at the caller's level.

import { entityKey, type Snapshot } from './compare.ts';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** One instant, one spelling: UTC with every fractional digit kept. */
export function instant(value: unknown): string | null {
  if (typeof value !== 'string' || !ISO.test(value)) return value == null ? null : String(value);
  const ms = Date.parse(value);
  const frac = (value.match(/\.(\d+)/)?.[1] ?? '').padEnd(9, '0');
  return `${new Date(ms).toISOString().slice(0, 19)}.${frac}Z`;
}

export type Row = { key: string; notifiedAt: string | null; name: unknown };

export function project(snapshot: Pick<Snapshot, 'entities'>): Row[] {
  return snapshot.entities.map((entity) => {
    const e = entity as Record<string, unknown>;
    return { key: entityKey(e), notifiedAt: instant(e.notified_at ?? e.notifiedAt ?? null), name: e.name ?? null };
  });
}

export const sameRows = (a: Row[], b: Row[]) => JSON.stringify(a) === JSON.stringify(b);

/** The first place two projections part, for the report. */
export function rowsDiff(a: Row[], b: Row[]): string | null {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return `row ${i}: ${JSON.stringify(a[i] ?? null)} vs ${JSON.stringify(b[i] ?? null)}`;
  }
  return null;
}
