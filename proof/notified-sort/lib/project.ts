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

/**
 * How a mounted list parts from a fresh read of it, as tokens: a row it shows
 * that the read lacks (`extra:<key>`), a row the read has that it lacks
 * (`missing:<key>`), a shared row under another name or notification time
 * (`name:<key>`, `notifiedAt:<key>`), and `order` when the shared rows sit in
 * another order. No tokens means the list shows what the read shows.
 */
export function discrepancies(live: Row[], fresh: Row[]): string[] {
  const freshByKey = new Map(fresh.map((r) => [r.key, r]));
  const liveKeys = new Set(live.map((r) => r.key));
  const tokens: string[] = [];
  for (const row of live) {
    const other = freshByKey.get(row.key);
    if (!other) tokens.push(`extra:${row.key}`);
    else {
      if (JSON.stringify(row.name) !== JSON.stringify(other.name)) tokens.push(`name:${row.key}`);
      if (row.notifiedAt !== other.notifiedAt) tokens.push(`notifiedAt:${row.key}`);
    }
  }
  for (const row of fresh) if (!liveKeys.has(row.key)) tokens.push(`missing:${row.key}`);
  const sharedLive = live.filter((r) => freshByKey.has(r.key)).map((r) => r.key);
  const sharedFresh = fresh.filter((r) => liveKeys.has(r.key)).map((r) => r.key);
  if (sharedLive.join('\n') !== sharedFresh.join('\n')) tokens.push('order');
  return tokens;
}

export type Paging = { pages: number; hasNextPage: boolean };

/**
 * A mounted list holds only the pages it loaded, and a re-read keeps that
 * count (both transports: urql-solid/infinite-query-observer.ts refetch reads
 * `this.pages.length` pages, TanStack's infinite refetch its loaded pages).
 * When rows join above them, the rows its last page no longer reaches move to
 * a page it has not loaded, and it says so with a next page. Its rows are then
 * the fresh read's first rows, exactly, and full pages of them.
 */
export function pastLoadedPages(live: Row[], fresh: Row[], paging: Paging | null, limit: number | undefined): boolean {
  if (!paging?.hasNextPage || !limit || paging.pages < 1) return false;
  if (live.length !== paging.pages * limit || live.length >= fresh.length) return false;
  return discrepancies(live, fresh.slice(0, live.length)).length === 0;
}

/**
 * The same full pages, but a row the fresh read dropped still holds a slot in
 * them, because no event told either side it left: main's mounted list shows
 * that row too, under the same notification time. Each such row pushes the
 * fresh read's next row past the loaded pages. Returns the stale rows when
 * that is all the list's difference: its other rows are the fresh read's first
 * rows, exactly, in full pages with a next page. Otherwise null.
 */
export function staleSlotPastPages(live: Row[], fresh: Row[], oldLive: Row[], paging: Paging | null, limit: number | undefined): Row[] | null {
  if (!paging?.hasNextPage || !limit || paging.pages < 1 || live.length !== paging.pages * limit) return null;
  const freshKeys = new Set(fresh.map((r) => r.key));
  const stale = live.filter((r) => !freshKeys.has(r.key));
  if (!stale.length) return null;
  const onOld = new Map(oldLive.map((r) => [r.key, r.notifiedAt]));
  if (!stale.every((r) => onOld.has(r.key) && onOld.get(r.key) === r.notifiedAt)) return null;
  const kept = live.filter((r) => freshKeys.has(r.key));
  if (kept.length >= fresh.length) return null;
  return discrepancies(kept, fresh.slice(0, kept.length)).length === 0 ? stale : null;
}

/** A REST read that main's 12 s Soup deadline cut off (closures T9, T11). */
export const REST_DEADLINE = /^rest error .*(TimeoutError: signal timed out|AbortError: The user aborted a request)/;
