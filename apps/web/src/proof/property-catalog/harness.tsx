// Differential harness page for the property catalog (proof only, never shipped).
//
// The runner (run.mjs) opens this page twice with the same account: once as NEW
// (the PR head) and once as OLD, where the three query modules
// lib/queries/properties/{definitions,options,tags}.ts are swapped for their
// copies from the base commit. Everything else on the page is the same code.
//
// The page mounts, under the app's own QueryClient and UserContextProvider:
//  - open readers: the real query hooks for a runner-chosen set of keys, kept
//    mounted across writes (the "live" view, refreshed by the app's own
//    invalidation and optimism);
//  - callers: the real catalog consumers' derivations (property panel, tag
//    picker and Settings list, filter bar, CRM stages and export columns,
//    task board, projects, select editor);
//  - the real mutation hooks, which the runner drives;
//  - a fresh subtree on demand with its own empty QueryClient (a cold load).
// Raw readers (the old REST queryFn and the new GraphQL reader) back the
// read-after-write and read-case checks.

import { createAppDealStages } from '@app/features/crm/stage-adapter';
import { createTagOptions } from '@app/features/next-soup/soup-view/filters-bar/tag-filter-state';
import { projectDefinitionProperties } from '@app/features/projects/queries/project-properties';
import { UserContextProvider, useIsAuthenticated } from '@core/context/user';
import { thrownResultErrorHasCode, throwOnErr } from '@core/util/result';
import { useAllProperties } from '@property/editor/hooks/useAllProperties';
import {
  TagSetsQueryProvider,
  useTagOptionById,
  useTagOptionSummaries,
  useTagSetsReady,
  useTagTree,
} from '@property/tags/tag-sets-context';
import { selectablePropertyOptions } from '@property/utils/select-options';
import { toPropertyDefinitionDomain } from '@property/utils/transforms';
import { queryClient } from '@queries/client';
import * as definitionsModule from '@queries/properties/definitions';
import {
  fetchPropertyDefinitionWithOptions,
  useCreatePropertyDefinitionMutation,
  useDeletePropertyDefinitionMutation,
  useListPropertiesQuery,
} from '@queries/properties/definitions';
import { propertiesKeys } from '@queries/properties/keys';
import * as optionsModule from '@queries/properties/options';
import {
  useAddPropertyOptionMutation,
  useDeletePropertyOptionMutation,
  usePropertyOptionsQuery,
  useUpdatePropertyOptionMutation,
} from '@queries/properties/options';
import { usablePropertyOptions } from '@queries/properties/options-data';
import * as tagsModule from '@queries/properties/tags';
import {
  useCreateTagMutation,
  useDeletePropertyOptionMutation as useDeleteTagMutation,
  useEnsureTagSetMutation,
  useMergeTagMutation,
  usePromoteTagMutation,
  useTagsQuery,
  useUpdatePropertyOptionMutation as useUpdateTagMutation,
} from '@queries/properties/tags';
import { authServiceClient } from '@service-auth/client';
import { propertiesServiceClient } from '@service-properties/client';
import {
  listPropertyDefinitions,
  listPropertyOptions,
  listTagSets,
} from '@service-storage/property-catalog';
import {
  hashKey,
  type InvalidateQueryFilters,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/solid-query';
import {
  type Accessor,
  createMemo,
  createRoot,
  createSignal,
  For,
  type JSX,
  onCleanup,
} from 'solid-js';
import { render } from 'solid-js/web';

type Key =
  | {
      k: 'defs';
      scope: string;
      includeOptions: boolean;
      forEntityType?: string;
    }
  | { k: 'opts'; id: string }
  | { k: 'tags' };

const keyId = (key: Key) => JSON.stringify(key);

// Plain data only: functions dropped, Maps and Sets as sorted entries.
function plain(value: unknown): unknown {
  if (value instanceof Map)
    return [...value.entries()]
      .map(([k, v]) => [String(k), plain(v)])
      .sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1));
  if (value instanceof Set) return [...value].map((v) => plain(v)).sort();
  if (Array.isArray(value)) return value.map((v) => plain(v));
  if (typeof value === 'function') return undefined;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const p = plain(v);
      if (p !== undefined) out[k] = p;
    }
    return out;
  }
  return value;
}

function errorShape(error: unknown) {
  if (!error) return null;
  const e = error as {
    constructor?: { name?: string };
    errors?: { code?: string }[];
    response?: { status?: number };
    graphQLErrors?: unknown[];
    networkError?: unknown;
  };
  return {
    class: e.constructor?.name ?? typeof error,
    codes: Array.isArray(e.errors) ? e.errors.map((x) => x.code ?? null) : null,
    httpStatus: e.response?.status ?? null,
    graphqlCodes: Array.isArray(e.graphQLErrors)
      ? e.graphQLErrors.map(
          (g) =>
            (g as { extensions?: { code?: string } }).extensions?.code ?? null
        )
      : null,
    // The query client's own retry decision (lib/queries/client.ts); the
    // whole message with ids masked, for the signature; and the whole
    // message as it is, which equality compares.
    retry:
      thrownResultErrorHasCode(error, 'UNAUTHORIZED') ||
      thrownResultErrorHasCode(error, 'FORBIDDEN')
        ? 'terminal'
        : 'retried',
    message: String((error as Error)?.message ?? error).replace(
      /[0-9a-f]{8}-[0-9a-f-]{27}/gi,
      '<id>'
    ),
    fullMessage: String((error as Error)?.message ?? error),
  };
}

type QueryLike = {
  status: string;
  fetchStatus: string;
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  isFetched: boolean;
  isPlaceholderData: boolean;
  isLoading: boolean;
  isStale: boolean;
  isRefetching: boolean;
  isRefetchError: boolean;
  isLoadingError: boolean;
  failureCount: number;
  data: unknown;
  error: unknown;
};

function observe(q: QueryLike) {
  return {
    status: q.status,
    fetchStatus: q.fetchStatus,
    isPending: q.isPending,
    isSuccess: q.isSuccess,
    isError: q.isError,
    isFetched: q.isFetched,
    isPlaceholderData: q.isPlaceholderData,
    isLoading: q.isLoading,
    isStale: q.isStale,
    isRefetching: q.isRefetching,
    isRefetchError: q.isRefetchError,
    isLoadingError: q.isLoadingError,
    failureCount: q.failureCount,
    data: plain(q.data),
    error: errorShape(q.error),
  };
}

// A caller that throws is recorded as its error, so one failure cannot hide the rest.
function safe<T>(f: () => T): T | { thrown: string } {
  try {
    return f();
  } catch (e) {
    return { thrown: String((e as Error)?.message ?? e).slice(0, 200) };
  }
}

type Registry = Map<string, () => unknown>;

function Reader(props: { spec: Key; registry: Registry }) {
  const spec = props.spec;
  const id = keyId(spec);
  let read: () => unknown;
  if (spec.k === 'defs') {
    const q = useListPropertiesQuery(() => ({
      scope: spec.scope as 'all',
      includeOptions: spec.includeOptions,
      forEntityType: spec.forEntityType as undefined,
    }));
    read = () => observe(q as unknown as QueryLike);
  } else if (spec.k === 'opts') {
    const q = usePropertyOptionsQuery(() => spec.id);
    read = () => observe(q as unknown as QueryLike);
  } else {
    const q = useTagsQuery();
    read = () => observe(q as unknown as QueryLike);
  }
  props.registry.set(id, read);
  onCleanup(() => props.registry.delete(id));
  return null;
}

// --- callers: what each catalog consumer derives from the catalog ---

function TagSetsCallers(props: { out: (f: () => unknown) => void }) {
  const summaries = useTagOptionSummaries();
  const tree = useTagTree();
  const byId = useTagOptionById();
  const ready = useTagSetsReady();
  props.out(() => ({
    options: plain(summaries()),
    tree: plain(tree()),
    optionById: plain(byId()),
    ready: ready(),
  }));
  return null;
}

function Callers(props: { registry: Registry; optionIds: Accessor<string[]> }) {
  // Property panel, PropertyEditorModal, activity, soup actions.
  const allProperties = useAllProperties();
  // Filter bar (next-soup tag filter).
  const filterTags = createTagOptions();
  // CRM deal stages (stage-adapter.ts), with the real team CRM config query.
  const stages = createAppDealStages();
  // CRM export columns (crm-adapter.ts:345, mapping copied verbatim).
  const crmExport = useListPropertiesQuery(() => ({
    scope: 'all',
    includeOptions: true,
    forEntityType: 'COMPANY',
  }));
  // Task board / tasks query / gantt / task-field-source / projects all read
  // system definitions with options.
  const system = useListPropertiesQuery(() => ({
    scope: 'system',
    includeOptions: true,
  }));
  // Select editor fallback: the entity property's own options come from the
  // all-definitions listing.
  const all = useListPropertiesQuery(() => ({
    scope: 'all',
    includeOptions: true,
  }));
  // The catalog the callers derive from, read for the runner's tie-order
  // check only (which rows the server sorts as equal); never compared.
  const tags = useTagsQuery();
  let tagSetsOut: () => unknown = () => null;

  // A select editor's options: its own query, or the all-definitions
  // listing's copy while that query has nothing usable.
  const editorOptions = (id: string) => {
    const q = props.registry.get(keyId({ k: 'opts', id }));
    const state = q?.() as ReturnType<typeof observe> | undefined;
    const fallbackEntry = (all.data ?? []).find(
      (d) => ('definition' in d ? d.definition.id : d.id) === id
    );
    const fallback =
      fallbackEntry && 'property_options' in fallbackEntry
        ? fallbackEntry.property_options
        : [];
    const usable = state
      ? usablePropertyOptions(
          {
            data: state.data as never,
            isError: state.isError,
            isPlaceholderData: state.isPlaceholderData,
          },
          fallback
        )
      : [];
    return { state, fallback, usable };
  };

  const read = () => ({
    // Each caller's own list, by name (run.mjs `CALLER_SOURCES`).
    __sources: {
      // What each list holds, kept through a refetch error as its callers
      // keep showing it (only a pending read has nothing).
      all: all.isPending ? null : plain(all.data),
      system: system.isPending ? null : plain(system.data),
      crmExport: crmExport.isPending ? null : plain(crmExport.data),
      tags: tags.isPending ? null : plain(tags.data),
      placeholder: {
        all: all.isPlaceholderData,
        system: system.isPlaceholderData,
        crmExport: crmExport.isPlaceholderData,
        tags: tags.isPlaceholderData,
      },
      failing: {
        all: all.isError,
        system: system.isError,
        crmExport: crmExport.isError,
        tags: tags.isError,
      },
      // The select editors' tie keys come from the list each one shows.
      opts: safe(() =>
        props.optionIds().map((id) => ({
          id,
          options: plain(editorOptions(id).usable),
        }))
      ),
    },
    propertyPanel: safe(() => plain(allProperties())),
    filterBar: safe(() => ({
      settled: filterTags.settled(),
      hasTags: filterTags.hasTags(),
      options: filterTags.options().map((o) => ({ id: o.id, label: o.label })),
      colors: filterTags
        .tagSets()
        .flatMap((s) => s.options.map((o) => [o.id, o.color ?? null])),
      definitionIds: plain(filterTags.definitionIds()),
      defByOption: plain(filterTags.defByOption()),
    })),
    tagPickerAndSettings: safe(() => tagSetsOut()),
    crmStages: safe(() => ({
      stages: plain(stages.stages()),
      filterStages: plain(stages.filterStages()),
      isCustomized: stages.isCustomized(),
      stageDefinitionId: stages.stageDefinitionId(),
      stageProperty: plain(stages.stageProperty()),
      isLoading: stages.isLoading(),
      isError: stages.isError(),
    })),
    crmExport: safe(() => ({
      isPending: crmExport.isPending,
      isSuccess: crmExport.isSuccess,
      isError: crmExport.isError,
      data: plain(
        (crmExport.data ?? []).map((entry) =>
          'definition' in entry
            ? entry
            : { definition: entry, property_options: [] }
        )
      ),
    })),
    taskBoard: safe(() =>
      plain(
        new Map(
          (system.isSuccess ? system.data : []).map((item) => {
            const definition = 'definition' in item ? item.definition : item;
            const options =
              'property_options' in item ? item.property_options : [];
            return [
              definition.id,
              toPropertyDefinitionDomain(definition, options),
            ];
          })
        )
      )
    ),
    projects: safe(() => ({
      loading: system.isPending,
      properties: plain(
        system.isPending ? [] : projectDefinitionProperties(system.data ?? [])
      ),
    })),
    selectEditors: safe(() =>
      props.optionIds().map((id) => {
        const { state, fallback, usable } = editorOptions(id);
        if (!state) return { id, mounted: false };
        return {
          id,
          shown: plain(
            selectablePropertyOptions({ options: fallback } as never, usable)
          ),
          loading: state.isPending,
        };
      })
    ),
  });

  props.registry.set('callers', read);
  onCleanup(() => props.registry.delete('callers'));
  return (
    <TagSetsQueryProvider>
      <TagSetsCallers out={(f) => (tagSetsOut = f)} />
    </TagSetsQueryProvider>
  );
}

// --- mutations: the real hooks the app's screens call ---

type Wrapped = (vars: unknown) => Promise<unknown>;

function Mutations(props: { out: (m: Record<string, Wrapped>) => void }) {
  const hooks = {
    createDef: useCreatePropertyDefinitionMutation(),
    deleteDef: useDeletePropertyDefinitionMutation(),
    addOption: useAddPropertyOptionMutation(),
    updateOption: useUpdatePropertyOptionMutation(),
    deleteOption: useDeletePropertyOptionMutation(),
    ensureTagSet: useEnsureTagSetMutation(),
    createTag: useCreateTagMutation(),
    updateTag: useUpdateTagMutation(),
    deleteTag: useDeleteTagMutation(),
    promoteTag: usePromoteTagMutation(),
    mergeTag: useMergeTagMutation(),
  } as Record<string, { mutateAsync: Wrapped }>;
  const out: Record<string, Wrapped> = {};
  for (const [name, hook] of Object.entries(hooks))
    out[name] = (vars) => hook.mutateAsync(vars as never);
  props.out(out);
  return null;
}

// --- page state ---

const [openKeys, setOpenKeys] = createSignal<Key[]>([]);
const registry: Registry = new Map();
let authenticated: () => boolean | undefined = () => undefined;

function AuthProbe() {
  const isAuthenticated = useIsAuthenticated();
  authenticated = () => isAuthenticated();
  return null;
}
let mutations: Record<string, Wrapped> = {};

const optionIdsOpen = createRoot(() =>
  createMemo(() =>
    openKeys().flatMap((key) => (key.k === 'opts' ? [key.id] : []))
  )
);

function Tree(props: {
  registry: Registry;
  keys: Accessor<Key[]>;
  optionIds: Accessor<string[]>;
  withMutations: boolean;
}): JSX.Element {
  return (
    <UserContextProvider>
      <For each={props.keys()}>
        {(spec) => <Reader spec={spec} registry={props.registry} />}
      </For>
      <Callers registry={props.registry} optionIds={props.optionIds} />
      {props.withMutations ? <Mutations out={(m) => (mutations = m)} /> : null}
      {props.withMutations ? <AuthProbe /> : null}
    </UserContextProvider>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('no #root');
render(
  () => (
    <QueryClientProvider client={queryClient}>
      <Tree
        registry={registry}
        keys={openKeys}
        optionIds={optionIdsOpen}
        withMutations
      />
    </QueryClientProvider>
  ),
  root
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// API fetches as this page saw them, so a settle timeout separates a request
// the page sent late from an answer that came back late. Only the timing is
// kept; the wrapper passes every call through unchanged.
type FetchNote = {
  method: string;
  path: string;
  op: string | null;
  start: number;
  end: number | null;
  status: number | null;
};
const fetchNotes: FetchNote[] = [];
const pageFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    location.href
  );
  const note: FetchNote = {
    method: (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase(),
    path: url.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '<id>'),
    op: operationName(init?.body),
    start: performance.now(),
    end: null,
    status: null,
  };
  if (!/^\/(src|node_modules|@)/.test(url.pathname)) {
    fetchNotes.push(note);
    if (fetchNotes.length > 60) fetchNotes.shift();
  }
  const res = await pageFetch(input, init);
  note.end = performance.now();
  note.status = res.status;
  return res;
};
// A GraphQL request's operation name, so its fetches can be told apart.
function operationName(body: unknown): string | null {
  if (typeof body !== 'string') return null;
  try {
    const name = (JSON.parse(body) as { operationName?: unknown })
      .operationName;
    return typeof name === 'string' ? name : null;
  } catch {
    return null;
  }
}

// The fetches since a settle started, in ms from its start.
function fetchesSince(start: number) {
  return fetchNotes
    .filter((f) => f.end === null || f.end >= start)
    .map((f) => ({
      method: f.method,
      path: f.path,
      op: f.op,
      start: Math.round(f.start - start),
      end: f.end === null ? null : Math.round(f.end - start),
      status: f.status,
    }));
}

function busy(client: QueryClient, reg: Registry) {
  if (client.isFetching() > 0 || client.isMutating() > 0) return true;
  for (const [id, read] of reg) {
    if (id === 'callers') continue;
    const s = read() as { fetchStatus: string; status: string };
    if (s.fetchStatus !== 'idle') return true;
  }
  return false;
}

async function settle(client: QueryClient, reg: Registry, boundMs: number) {
  const start = performance.now();
  let quietSince = -1;
  while (performance.now() - start < boundMs) {
    if (!busy(client, reg)) {
      if (quietSince < 0) quietSince = performance.now();
      // two quiet frames in a row: no follow-up fetch was scheduled
      if (performance.now() - quietSince >= 60)
        return { ms: Math.round(quietSince - start), timedOut: false };
    } else quietSince = -1;
    await sleep(15);
  }
  return {
    ms: Math.round(performance.now() - start),
    timedOut: true,
    busy: busyNow(client, reg),
    fetches: fetchesSince(start),
  };
}

// The queries, mutations and readers still busy when a settle timed out.
function busyNow(client: QueryClient, reg: Registry) {
  const out: Record<string, unknown>[] = [];
  for (const q of client.getQueryCache().getAll())
    if (q.state.fetchStatus !== 'idle')
      out.push({
        query: JSON.stringify(q.queryKey).slice(0, 200),
        fetchStatus: q.state.fetchStatus,
        status: q.state.status,
        failures: q.state.fetchFailureCount,
      });
  if (client.isMutating() > 0) out.push({ mutating: client.isMutating() });
  for (const [id, read] of reg) {
    if (id === 'callers') continue;
    const s = read() as { fetchStatus: string; status: string };
    if (s.fetchStatus !== 'idle')
      out.push({ reader: id, fetchStatus: s.fetchStatus, status: s.status });
  }
  return out;
}

function snapshot(reg: Registry) {
  const out: Record<string, unknown> = {};
  for (const [id, read] of reg) out[id] = read();
  return out;
}

async function result<T>(f: () => Promise<T>) {
  try {
    return { ok: true as const, value: plain(await f()) };
  } catch (e) {
    return {
      ok: false as const,
      error: errorShape(e),
      message: String((e as Error)?.message ?? e).slice(0, 300),
    };
  }
}

// A cold load: a new, empty QueryClient with the app's defaults, the same
// readers and callers, mounted, settled, read, and torn down.
async function fresh(keys: Key[], boundMs: number) {
  const client = new QueryClient({
    defaultOptions: queryClient.getDefaultOptions(),
  });
  const reg: Registry = new Map();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const ids = keys.flatMap((key) => (key.k === 'opts' ? [key.id] : []));
  const dispose = render(
    () => (
      <QueryClientProvider client={client}>
        <Tree
          registry={reg}
          keys={() => keys}
          optionIds={() => ids}
          withMutations={false}
        />
      </QueryClientProvider>
    ),
    host
  );
  await sleep(0);
  const timing = await settle(client, reg, boundMs);
  const snap = snapshot(reg);
  dispose();
  host.remove();
  client.clear();
  return { timing, snap };
}

let staleCache: [readonly unknown[], unknown][] = [];
let skippedInvalidations = 0;
// The data each query held when the mutant swallowed its invalidation.
let skippedData = new Map<string, unknown>();

// The query an open reader reads, by its registry id (the reader's key).
function readerHash(id: string) {
  const spec = JSON.parse(id) as Key;
  if (spec.k === 'defs')
    return hashKey(
      propertiesKeys.definitions({
        scope: spec.scope as 'all',
        includeOptions: spec.includeOptions,
        forEntityType: spec.forEntityType as undefined,
      }).queryKey
    );
  if (spec.k === 'opts')
    return hashKey(
      propertiesKeys.options({ propertyDefinitionId: spec.id }).queryKey
    );
  return hashKey(propertiesKeys.tags.queryKey);
}
// The open readers whose query is one of these.
// The open readers of these queries, with the data the fault left in each.
function readersOf(data: Map<string, unknown>) {
  return [...registry.keys()]
    .filter((id) => id !== 'callers' && data.has(readerHash(id)))
    .map((id) => ({ id, data: data.get(readerHash(id)) }));
}

declare global {
  interface Window {
    __h: unknown;
    __harnessReady: boolean;
  }
}

window.__h = {
  setKeys(keys: Key[]) {
    setOpenKeys(keys);
  },
  settle: (boundMs = 5000) => settle(queryClient, registry, boundMs),
  snapshot: () => snapshot(registry),
  fresh,
  mutate: (name: string, vars: unknown) => {
    const m = mutations[name];
    if (!m)
      return Promise.resolve({
        ok: false,
        error: { class: 'harness', codes: [`no mutation ${name}`] },
      });
    return result(() => m(vars));
  },
  // Mutant hooks: break the new path on purpose to show the comparison sees it.
  authenticated: () => authenticated(),
  // Which query modules this page runs: the runner checks that the OLD page
  // runs the base commit's copies (run.sh marks them) and NEW the head's.
  moduleSides: () =>
    Object.fromEntries(
      [
        ['definitions', definitionsModule],
        ['options', optionsModule],
        ['tags', tagsModule],
      ].map(([name, mod]) => [
        name,
        Reflect.get(mod as object, '__PROOF_MODULE__') ?? 'head',
      ])
    ),
  // The property editor's imperative read after it creates a definition.
  imperative: {
    fetchDefinitionWithOptions: (id: string) =>
      result(() => fetchPropertyDefinitionWithOptions(id)),
  },
  mutant: {
    skipLiveUpdate() {
      queryClient.invalidateQueries = ((filters?: InvalidateQueryFilters) => {
        skippedInvalidations++;
        for (const q of queryClient.getQueryCache().findAll(filters))
          skippedData.set(q.queryHash, plain(q.state.data));
        return Promise.resolve();
      }) as typeof queryClient.invalidateQueries;
    },
    // Invalidations the mutant swallowed since the last call, and the open
    // readers they would have refreshed.
    takeSkipped() {
      const out = {
        count: skippedInvalidations,
        readers: readersOf(skippedData),
      };
      skippedInvalidations = 0;
      skippedData = new Map();
      return out;
    },
    // Stale cache: remember every property query's data before a write and
    // put it back after the page settles, as a cache that missed the write.
    takeCache() {
      staleCache = queryClient.getQueriesData({
        queryKey: propertiesKeys._def,
      });
    },
    // Returns how many entries it changed: putting back data the cache
    // already holds changes nothing and is not a fault applied.
    restoreCache() {
      let restored = 0;
      const restoredData = new Map<string, unknown>();
      for (const [key, data] of staleCache) {
        if (data === undefined) continue;
        if (
          JSON.stringify(queryClient.getQueryData(key)) === JSON.stringify(data)
        )
          continue;
        queryClient.setQueryData(key, data);
        restoredData.set(hashKey(key), plain(data));
        restored++;
      }
      staleCache = [];
      return { restored, readers: readersOf(restoredData) };
    },
  },
  raw: {
    old: {
      list: (a: {
        scope: string;
        includeOptions: boolean;
        forEntityType?: string;
      }) =>
        result(() =>
          throwOnErr(() =>
            propertiesServiceClient.listProperties({
              scope: a.scope as 'all',
              include_options: a.includeOptions,
              for_entity_type: a.forEntityType as undefined,
            })
          )
        ),
      options: (id: string) =>
        result(() =>
          throwOnErr(() =>
            propertiesServiceClient.getPropertyOptions({ definition_id: id })
          )
        ),
      tags: () =>
        result(() => throwOnErr(() => propertiesServiceClient.listTags())),
    },
    neu: {
      list: (a: {
        scope: string;
        includeOptions: boolean;
        forEntityType?: string;
      }) =>
        result(() =>
          listPropertyDefinitions({
            scope: a.scope as 'all',
            includeOptions: a.includeOptions,
            forEntityType: a.forEntityType as undefined,
          })
        ),
      options: (id: string) => result(() => listPropertyOptions(id)),
      tags: () => result(() => listTagSets()),
    },
  },
  // Setup-only writes (accounts, teams); never compared.
  setup: {
    rest: (op: string, args: unknown) =>
      result(() =>
        throwOnErr(() =>
          (
            propertiesServiceClient as unknown as Record<
              string,
              (a: unknown) => Promise<never>
            >
          )[op](args)
        )
      ),
    auth: (op: string, ...args: unknown[]) =>
      result(() =>
        throwOnErr(() =>
          (
            authServiceClient as unknown as Record<
              string,
              (...a: unknown[]) => Promise<never>
            >
          )[op](...args)
        )
      ),
  },
};
window.__harnessReady = true;
