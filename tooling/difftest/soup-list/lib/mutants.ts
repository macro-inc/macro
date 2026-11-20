/**
 * Mutants planted in the branch's read path: the new page's GraphQL Soup
 * responses are rewritten before the app sees them, as a bug in the moved
 * readers would. A mutant campaign runs sequences with one active and must
 * fail; a mutant the suites do not catch is a hole in the harness.
 *
 * - drop: the first row of every list is gone;
 * - swap: the first two rows trade places;
 * - alter: the first row's name changes;
 * - stale: every read returns the first response that read ever got (a cache
 *   that never takes a write, across reloads);
 * - skipLive: every live path the branch has is cut until the page reloads:
 *   a refetch (tanstack invalidation, urql refresh) gets the response the
 *   reader mounted with, active readers' refresh (refreshActiveGraphqlSoup-
 *   Queries) returns at once, and list and predicate readers stop hearing the
 *   browser cache's changes (host.onCacheChanged), in the modules Vite serves
 *   it. A live update never lands; a reload still reads fresh.
 */
import type { Page, Route } from 'playwright';

export const MUTANTS = ['drop', 'swap', 'alter', 'stale', 'skipLive'] as const;
export type Mutant = (typeof MUTANTS)[number];

type Json = unknown;

/** Every array of entity rows (objects with __typename and id) in a response. */
function rowArrays(value: Json, out: unknown[][] = []): unknown[][] {
  if (Array.isArray(value)) {
    if (value.length && value.every((v) => v && typeof v === 'object' && '__typename' in v && 'id' in v)) out.push(value);
    for (const v of value) rowArrays(v, out);
  } else if (value && typeof value === 'object') for (const v of Object.values(value)) rowArrays(v, out);
  return out;
}

export type MutantState = { mutated: number; served: number; onReload: () => void; /** Modules a code mutant found nothing to cut in. */ missed: string[] };

export async function plantMutant(page: Page, mutant: Mutant): Promise<MutantState> {
  const first = new Map<string, string>();
  let mounted = new Map<string, string>();
  const state: MutantState = { mutated: 0, served: 0, onReload: () => (mounted = new Map()), missed: [] };
  if (mutant === 'skipLive') {
    const cuts: [string, RegExp, string][] = [
      ['active-queries.ts', /(export async function refreshActiveGraphqlSoupQueries\([^)]*\)\s*\{)/, '$1 return;'],
      ['create-soup-live-query.ts', /host\.onCacheChanged\(/g, '((_listener, _options) => () => {})('],
      ['create-predicate-query.ts', /host\.onCacheChanged\(/g, '((_listener, _options) => () => {})('],
    ];
    for (const [file, pattern, replacement] of cuts)
      await page.route(`**/src/lib/queries/soup/graphql/${file}*`, async (route: Route) => {
        const response = await route.fetch();
        const text = await response.text();
        const out = text.replace(pattern, replacement);
        if (out !== text) state.mutated++;
        else state.missed.push(file);
        await route.fulfill({ response, body: out });
      });
  }
  await page.route('**/graphql', async (route: Route) => {
    const request = route.request();
    const body = request.postData() ?? '';
    let op = '';
    let key = '';
    try {
      const parsed = JSON.parse(body);
      op = parsed.operationName ?? '';
      key = `${op}:${JSON.stringify(parsed.variables ?? {})}`;
    } catch {}
    if (!/soup/i.test(op)) return route.continue();
    const response = await route.fetch();
    let text = await response.text();
    state.served++;
    if (mutant === 'stale' || mutant === 'skipLive') {
      const memo = mutant === 'stale' ? first : mounted;
      const kept = memo.get(key);
      if (kept === undefined) memo.set(key, text);
      else if (kept !== text) {
        text = kept;
        state.mutated++;
      }
    } else {
      try {
        const json = JSON.parse(text);
        let changed = false;
        for (const rows of rowArrays(json)) {
          if (mutant === 'drop' && rows.length >= 1) {
            rows.shift();
            changed = true;
          } else if (mutant === 'swap' && rows.length >= 2) {
            [rows[0], rows[1]] = [rows[1], rows[0]];
            changed = true;
          } else if (mutant === 'alter') {
            const row = rows[0] as Record<string, unknown>;
            for (const field of ['name', 'title', 'displayName'])
              if (typeof row[field] === 'string') {
                row[field] = `${row[field]} (mutant)`;
                changed = true;
              }
          }
        }
        if (changed) {
          text = JSON.stringify(json);
          state.mutated++;
        }
      } catch {}
    }
    await route.fulfill({ response, body: text });
  });
  return state;
}
