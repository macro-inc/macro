// Loaded into a running app by the differential driver (`run.sh` copies it to
// `apps/web/src/__proof__/probe.ts` of each worktree). It reads Soup through
// the app's own facade, `useSoupAstItemsQuery`, so the base worktree runs
// main's reader and the proof worktree runs the branch's, against the same
// backend, viewer and data. It shares the app's query client and GraphQL
// cache, like any other caller in that page.

import { SoupNotificationsDocument } from "@service-storage/graphql/generated/graphql";
import { getGraphqlSoupCacheHost, getGraphqlSoupClient } from "@service-storage/graphql-soup";
import { soupItemMatchesHomeTab } from "@app/features/home/queries/home-item-filter";
import { buildHomeQuery } from '@app/features/home/queries/home-query';
import {
  compileToAst,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store/compile';
import { getViewPreset } from '@app/features/next-soup/sidebar/soup-filter-presets';
import {
  compileClause,
  confine,
  type FacetClause,
  type TargetExpr,
} from '@app/features/soup/filters';
import type { GroupByField } from '@queries/soup/grouped/types';
import {
  type SoupAstItemsQueryArgs,
  useSoupAstItemsQuery,
} from '@queries/soup/items';
import { queryClient } from '@queries/client';
import { QueryClientProvider } from '@tanstack/solid-query';
import { createComponent, createRoot } from 'solid-js';

type Query = ReturnType<typeof useSoupAstItemsQuery>;

type ReadOptions = {
  /** Home's insert gate for this tab, as Home registers it. */
  homeTab?: "signal" | "noise";
  groupBy?: GroupByField;
  showForeign?: boolean;
  /** Network re-read after the first settle (a reload's fresh read). */
  fresh?: boolean;
  /** Walk every page (flat lists only). */
  allPages?: boolean;
  maxPages?: number;
  timeoutMs?: number;
  /**
   * Drop the cached lists no reader holds first, so a REST read starts from
   * page one the way a new caller's would (REST shares loaded pages between
   * readers of one key; GraphQL readers each keep their own).
   */
  clean?: boolean;
};

export type ProbeSnapshot = {
  transport: string;
  error: string | null;
  pages: number;
  hasNextPage: boolean;
  entities: unknown[];
  groups: unknown[] | null;
  itemsById: Record<string, unknown> | null;
  ms: number;
  /** Storage resets (R1) during this read, and since the probe loaded. */
  resets?: { during: number; sinceLoad: number };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Plain JSON of an entity: accessors (zero-arity functions) are read. */
function plain(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (depth > 12) return '[depth]';
  if (typeof value === 'function') {
    if (value.length !== 0) return '[fn]';
    try {
      return { $fn: plain((value as () => unknown)(), seen, depth + 1) };
    } catch (error) {
      return { $fnError: String(error) };
    }
  }
  if (value === null || typeof value !== 'object') {
    return typeof value === 'number' && !Number.isFinite(value)
      ? String(value)
      : value;
  }
  if (value instanceof Date) return { $date: value.toISOString() };
  if (seen.has(value)) return '[cycle]';
  seen.add(value);
  try {
    if (Array.isArray(value))
      return value.map((each) => plain(each, seen, depth + 1));
    if (value instanceof Map)
      return {
        $map: [...value].map(([k, v]) => [k, plain(v, seen, depth + 1)]),
      };
    if (value instanceof Set)
      return { $set: [...value].map((v) => plain(v, seen, depth + 1)) };
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = plain(
        (value as Record<string, unknown>)[key],
        seen,
        depth + 1
      );
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

const settled = (query: Query) =>
  !query.isPending &&
  !query.isLoading &&
  !query.isFetching &&
  !query.isFetchingNextPage;

async function waitSettled(query: Query, deadline: number) {
  // A query that has not started yet reads as settled for a tick.
  await sleep(30);
  let stable = 0;
  while (Date.now() < deadline) {
    if (settled(query)) {
      stable += 1;
      if (stable >= 3) return;
    } else {
      stable = 0;
    }
    await sleep(25);
  }
  throw new Error('probe: query did not settle in time');
}

function snapshot(query: Query, pages: number, started: number): ProbeSnapshot {
  const data = query.data;
  return {
    transport: query.transport,
    error: query.error ? String(query.error.message ?? query.error) : null,
    pages,
    hasNextPage: query.hasNextPage,
    entities: (data?.entities ?? []).map((entity) => plain(entity)),
    groups: data?.groups ? (plain(data.groups) as unknown[]) : null,
    itemsById: data?.itemsById
      ? (plain(data.itemsById) as Record<string, unknown>)
      : null,
    ms: Date.now() - started,
  };
}

function mount(args: SoupAstItemsQueryArgs, options: ReadOptions) {
  // The app's own query client, provided the way the app's root provides it.
  return createRoot((dispose) => {
    let query!: Query;
    createComponent(QueryClientProvider, {
      client: queryClient,
      get children() {
        query = useSoupAstItemsQuery(
          () => ({ ...args, groupBy: options.groupBy }),
          () => ({
            showSupportedForeignEntities: options.showForeign ?? true,
            ...(options.homeTab
              ? { meta: { insertFilter: homeInsertFilter(options.homeTab) } }
              : {}),
          })
        );
        return null;
      },
    });
    return { query, dispose };
  });
}

/** One read through the facade, as a fresh caller would make it. */
async function read(
  args: SoupAstItemsQueryArgs,
  options: ReadOptions = {}
): Promise<ProbeSnapshot> {
  // A storage reset mid-read leaves a reader outside the app's tree empty
  // (R1); the read says so, and the harness reads again.
  watchResets();
  const resetsBefore = resetReopens.length;
  if (options.clean) queryClient.removeQueries({ type: "inactive" });
  const started = Date.now();
  const deadline = started + (options.timeoutMs ?? 60_000);
  const { query, dispose } = mount(args, options);
  try {
    await waitSettled(query, deadline);
    if (options.fresh) {
      await query.refresh().catch(() => undefined);
      await waitSettled(query, deadline);
    }
    let pages = 1;
    if (options.allPages !== false && !options.groupBy) {
      const max = options.maxPages ?? 80;
      while (query.hasNextPage && pages < max && !query.error) {
        await query.fetchNextPage().catch(() => undefined);
        await waitSettled(query, deadline);
        pages += 1;
      }
    }
    return { ...snapshot(query, pages, started), resets: { during: resetReopens.length - resetsBefore, sinceLoad: resetReopens.length } };
  } finally {
    dispose();
  }
}

const live = new Map<string, { query: Query; dispose: () => void; pages: number; args: SoupAstItemsQueryArgs; options: ReadOptions }>();

/**
 * A storage reset (the cache emptied: a sign-out wipe, or an engine restart
 * while the page was parked, as at an access-token lapse) leaves a reader
 * mounted outside the app's tree with no rows and nothing that reads again,
 * while the app's own Home lists refill. Each reset reopens every mounted
 * reader with the pages it had, so live checks compare what a list on screen
 * shows; the count goes into the evidence.
 */
const RESET_REOPEN_DELAY_MS = 2000;
const resetReopens: { at: string; ids: string[] }[] = [];
let resetWatch = false;
function watchResets() {
  if (resetWatch) return;
  const host = getGraphqlSoupCacheHost();
  if (!host) return;
  resetWatch = true;
  host.onCacheGenerationChanged((change: unknown) => {
    if ((change as { storage?: string } | undefined)?.storage !== "reset") return;
    const ids = [...live.keys()];
    resetReopens.push({ at: new Date().toISOString(), ids });
    // After the reset settles: a reader mounted inside the reset callback reads
    // the emptied cache before the new session and never fetches.
    setTimeout(() => {
      for (const id of ids) {
        const entry = live.get(id);
        if (entry) openLive(id, entry.args, { ...entry.options, maxPages: entry.pages }).catch(() => undefined);
      }
    }, RESET_REOPEN_DELAY_MS);
  });
}

/** Opens a reader that stays mounted, like a list on screen. */
async function openLive(
  id: string,
  args: SoupAstItemsQueryArgs,
  options: ReadOptions = {}
): Promise<ProbeSnapshot> {
  closeLive(id);
  watchResets();
  const started = Date.now();
  const { query, dispose } = mount(args, options);
  const entry = { query, dispose, pages: 1, args, options };
  live.set(id, entry);
  const deadline = started + (options.timeoutMs ?? 60_000);
  await waitSettled(query, deadline);
  // A list scrolled a few pages down: later pages stay loaded and are read
  // again with the first.
  if (!options.groupBy) {
    const max = Math.min(options.maxPages ?? 1, 5);
    while (query.hasNextPage && entry.pages < max && !query.error) {
      await query.fetchNextPage().catch(() => undefined);
      await waitSettled(query, deadline);
      entry.pages += 1;
    }
  }
  return snapshot(query, entry.pages, started);
}

function snapLive(id: string): ProbeSnapshot | null {
  const entry = live.get(id);
  if (!entry) return null;
  return { ...snapshot(entry.query, entry.pages, Date.now()), ms: 0 };
}

function liveSettled(id: string): boolean {
  const entry = live.get(id);
  return entry ? settled(entry.query) : true;
}

function closeLive(id: string) {
  live.get(id)?.dispose();
  live.delete(id);
}

function closeAllLive() {
  for (const id of [...live.keys()]) closeLive(id);
}

/** Home's own query for a tab and facet selection, from this worktree's code. */
function homeArgs(input: {
  tab: 'signal' | 'noise';
  facets: Record<string, string[]>;
  userId: string;
  foreignEntities: boolean;
}): SoupAstItemsQueryArgs {
  return buildHomeQuery({
    tab: input.tab,
    facets: input.facets,
    facetContext: {},
    capabilities: {
      foreignEntities: input.foreignEntities,
      notifiedSort: true,
    },
    userId: input.userId,
  });
}


/**
 * Args for a generated filter: one boolean tree per Soup target, compiled by
 * the app's own clause compiler, as the soup view's filters are.
 */
function filterArgs(input: {
  filters: Record<string, TargetExpr>;
  confined: boolean;
  emailView?: 'inbox';
  params: Record<string, unknown>;
}): SoupAstItemsQueryArgs {
  const filters = input.filters as FacetClause;
  const body = compileClause(input.confined ? confine(filters) : filters) as SoupAstItemsQueryArgs['body'];
  if (input.emailView) (body as Record<string, unknown>).emailView = input.emailView;
  return { params: input.params as SoupAstItemsQueryArgs['params'], body };
}

/** The soup view's Home preset tabs (notified-at sort), compiled the same way. */
function presetArgs(tab: 'signal' | 'noise', params: Record<string, unknown>): SoupAstItemsQueryArgs {
  const preset = getViewPreset('home', tab);
  if (!preset) throw new Error(`no home preset ${tab}`);
  return {
    params: { limit: 100, sort_method: preset.sortMethod, ...params } as SoupAstItemsQueryArgs['params'],
    body: compileToAst(queryStateFrom(preset.filters)) as SoupAstItemsQueryArgs['body'],
  };
}

type Source =
  | { kind: 'home'; tab: 'signal' | 'noise'; facets: Record<string, string[]>; foreignEntities: boolean }
  | { kind: 'filter'; filters: Record<string, TargetExpr>; confined: boolean; emailView?: 'inbox' }
  | { kind: 'preset'; tab: 'signal' | 'noise' };

type ReadSpec = ReadOptions & {
  source: Source;
  params?: Record<string, unknown>;
};

/** The args a spec names, built with this side's own code. */
function argsFor(userId: string, spec: ReadSpec): SoupAstItemsQueryArgs {
  const s = spec.source;
  const base =
    s.kind === 'home'
      ? homeArgs({ tab: s.tab, facets: s.facets, foreignEntities: s.foreignEntities, userId })
      : s.kind === 'preset'
        ? presetArgs(s.tab, {})
        : filterArgs({
            filters: s.filters,
            confined: s.confined,
            emailView: s.emailView,
            params: { expand: true, limit: 100, sort_method: 'notified_at', sort_direction: 'desc' },
          });
  return { ...base, params: { ...base.params, ...spec.params } as SoupAstItemsQueryArgs['params'] };
}

async function readSpec(userId: string, spec: ReadSpec) {
  const args = argsFor(userId, spec);
  return { ...(await read(args, withGate(spec))), args };
}

async function openLiveSpec(id: string, userId: string, spec: ReadSpec) {
  const args = argsFor(userId, spec);
  return { ...(await openLive(id, args, withGate(spec))), args };
}

/** Home lists carry Home's insert gate, as `useHomeEntitiesQuery` sets it. */
function withGate(spec: ReadSpec): ReadSpec {
  return spec.source.kind === "home" ? { ...spec, homeTab: spec.source.tab } : spec;
}

function homeInsertFilter(tab: "signal" | "noise") {
  return (item: Parameters<typeof soupItemMatchesHomeTab>[0]) => soupItemMatchesHomeTab(item, tab);
}
/** Every cached query whose data mentions `needle`, with a snippet around it. */
function findInCache(needle: string) {
  return queryClient
    .getQueryCache()
    .getAll()
    .flatMap((q) => {
      let text: string;
      try {
        text = JSON.stringify(q.state.data) ?? "";
      } catch {
        return [];
      }
      const at = text.indexOf(needle);
      if (at < 0) return [];
      return [{ key: JSON.stringify(q.queryKey).slice(0, 300), snippet: text.slice(Math.max(0, at - 600), at + 600) }];
    });
}

/** The notification source's own query, read once from the network. */
async function notificationSource(limit = 500) {
  const result = await getGraphqlSoupClient()
    .query(SoupNotificationsDocument, { input: { initial: { expand: true, limit, sortMethod: "NOTIFIED_AT" } } }, { requestPolicy: "network-only" })
    .toPromise();
  if (result.error) throw new Error(String(result.error));
  return (result.data?.user.soup.items ?? []).map((item: any) => ({
    typename: item.__typename,
    id: item.id,
    notifications: item.notifications.map((n: any) => ({ id: n.id, entityId: n.entityId, targetEntityType: n.targetEntityType, state: n.state })),
  }));
}

/** A mounted reader's own state, for diagnosing a list that empties. */
function liveDebug(id: string) {
  const q = live.get(id)?.query as unknown as Record<string, unknown> | undefined;
  if (!q) return null;
  const read = (k: string) => { try { const v = q[k]; return typeof v === "function" ? (v as () => unknown)() : v; } catch (e) { return `throws ${String(e)}`; } };
  const data = q.data as { entities?: unknown[] } | undefined;
  return {
    entities: data?.entities?.length ?? null,
    isPending: read("isPending"), isFetching: read("isFetching"), isFetchingNextPage: read("isFetchingNextPage"), isLoading: read("isLoading"), pages: live.get(id)?.pages, hasPageData: read("hasPageData"),
    cacheStatus: read("cacheStatus"), hasNextPage: read("hasNextPage"), transport: read("transport"),
    error: q.error ? String((q.error as { message?: string }).message ?? q.error) : null,
  };
}

/** Cache generation changes since the probe loaded, with their time. */
const generations: { at: string; change: unknown }[] = [];
function watchGenerations() {
  const host = getGraphqlSoupCacheHost();
  if (!host) return false;
  host.onCacheGenerationChanged((change: unknown) => generations.push({ at: new Date().toISOString(), change }));
  return true;
}

/** Empties the normalized cache the way a sign-out wipe does (a storage reset). */
async function clearCache() {
  const host = getGraphqlSoupCacheHost();
  if (!host) return "no host";
  await host.clear();
  return "cleared";
}

const probe = {
  resetReopens: () => resetReopens,
  liveDebug,
  clearCache,
  generations: () => generations,
  watchGenerations,
  notificationSource,
  findInCache,
  read,
  openLive,
  snapLive,
  liveSettled,
  closeLive,
  closeAllLive,
  homeArgs,
  filterArgs,
  presetArgs,
  readSpec,
  openLiveSpec,
};

(window as unknown as { __proofProbe: typeof probe }).__proofProbe = probe;

export default probe;
