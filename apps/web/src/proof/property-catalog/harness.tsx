// Differential harness page for the property catalog (proof only, never shipped).
//
// The runner (run.mjs) opens this page once per account. An OLD page runs the
// base commit's web code: every web module the PR changed is swapped for its
// base copy (run.sh writes them as `*.__old__.*`, the runner's route serves
// them), so OLD is main's REST + TanStack catalog end to end. A NEW page runs
// the PR head: GraphQL reads live from the normalized cache, GraphQL
// mutations with optimistic updates. Everything else on the page is the same
// code.
//
// The two sides are twin worlds: OLD's accounts and NEW's are different users
// on the same server, and each side really writes. The runner pairs their ids.
//
// The page mounts, under the app's own QueryClient and UserContextProvider:
//  - open readers: the real query hooks for a runner-chosen set of keys, kept
//    mounted across writes (the "live" view);
//  - callers: the real catalog consumers' derivations (property panel, tag
//    picker and Settings list, filter bar, CRM stages and export columns,
//    task board, projects, select editor);
//  - the real mutation hooks, which the runner drives;
//  - a fresh subtree on demand with its own empty QueryClient (a new mount;
//    on NEW it shares the normalized cache, as a new screen in the app does).
//
// Imports of modules the PR changed are namespace imports, so a name one
// side lacks is `undefined` there rather than a link error that kills the
// page. Head-only modules load only on NEW, by dynamic import.

import { createAppDealStages } from '@app/features/crm/stage-adapter';
import { createTagOptions } from '@app/features/next-soup/soup-view/filters-bar/tag-filter-state';
import { projectDefinitionProperties } from '@app/features/projects/queries/project-properties';
import * as toastModule from '@core/component/Toast/Toast';
import { SERVER_HOSTS } from '@core/constant/servers';
import { UserContextProvider, useIsAuthenticated } from '@core/context/user';
import { fetchWithToken } from '@core/util/fetchWithToken';
import { throwOnErr } from '@core/util/result';
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
import * as keysModule from '@queries/properties/keys';
import * as optionsModule from '@queries/properties/options';
import { usablePropertyOptions } from '@queries/properties/options-data';
import * as tagsModule from '@queries/properties/tags';
import { authServiceClient } from '@service-auth/client';
import * as propertiesClientModule from '@service-properties/client';
import * as graphqlModule from '@service-storage/graphql/generated/graphql';
import * as soupModule from '@service-storage/graphql-soup';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { stringifyDocument } from '@urql/core';
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

type AnyFn = (...args: never[]) => unknown;
// A module's export by name; `undefined` when this side's copy has none.
const exp = <T = AnyFn>(mod: object, name: string) =>
  Reflect.get(mod, name) as T | undefined;
const call = <T = unknown>(mod: object, name: string, ...args: unknown[]) => {
  const f = exp<(...a: unknown[]) => T>(mod, name);
  if (!f) throw new Error(`harness: this side has no export ${name}`);
  return f(...args);
};

// Plain data only: functions dropped, Maps and Sets tagged so the runner can
// re-sort them by key once ids are translated.
function plain(value: unknown): unknown {
  if (value instanceof Map)
    return {
      '<map>': [...value.entries()]
        .map(([k, v]) => [String(k), plain(v)])
        .sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1)),
    };
  if (value instanceof Set)
    return { '<set>': [...value].map((v) => plain(v)).sort() };
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

// What the transport said, for diagnosis only (never compared: OLD fails
// with a ThrownResultError, NEW with a CombinedError or CatalogMutationError).
function errorDetail(error: unknown) {
  if (!error) return null;
  const e = error as {
    constructor?: { name?: string };
    errors?: { code?: string }[];
    response?: { status?: number };
    graphQLErrors?: { extensions?: { code?: string } }[];
    networkError?: unknown;
    code?: unknown;
  };
  return {
    class: e.constructor?.name ?? typeof error,
    codes: Array.isArray(e.errors) ? e.errors.map((x) => x.code ?? null) : null,
    code: typeof e.code === 'string' ? e.code : null,
    httpStatus: e.response?.status ?? null,
    graphqlCodes: Array.isArray(e.graphQLErrors)
      ? e.graphQLErrors.map((g) => g.extensions?.code ?? null)
      : null,
    network: !!e.networkError,
    message: String((error as Error)?.message ?? error).slice(0, 300),
  };
}

// What a reader's callers can see: these fields are the hooks' contract on
// both sides (the head types expose exactly these). Busy fields are kept
// apart, for settling only.
type QueryLike = {
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  isFetched: boolean;
  isPlaceholderData?: boolean;
  isLoading: boolean;
  isFetching?: boolean;
  fetchStatus?: string;
  data: unknown;
  error: unknown;
};

function observe(q: QueryLike, withPlaceholder: boolean) {
  return {
    isPending: q.isPending,
    isSuccess: q.isSuccess,
    isError: q.isError,
    isFetched: q.isFetched,
    isLoading: q.isLoading,
    ...(withPlaceholder ? { isPlaceholderData: !!q.isPlaceholderData } : {}),
    data: plain(q.data),
    error: q.error ? true : null,
    busy: {
      isFetching: !!q.isFetching,
      fetchStatus: q.fetchStatus ?? null,
    },
    errorDetail: errorDetail(q.error),
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
type Observed = ReturnType<typeof observe>;

// The skip-live-update mutant (NEW only): readers it froze show the data they
// held before a write until the runner releases them.
const frozen = new Map<string, unknown>();
// The page's own open readers, unfrozen, by key.
const liveReaders = new Map<string, () => Observed>();

function Reader(props: { spec: Key; registry: Registry }) {
  const spec = props.spec;
  const id = keyId(spec);
  let read: () => Observed;
  if (spec.k === 'defs') {
    const q = call<QueryLike>(
      definitionsModule,
      'useListPropertiesQuery',
      () => ({
        scope: spec.scope,
        includeOptions: spec.includeOptions,
        forEntityType: spec.forEntityType,
      })
    );
    read = () => observe(q, false);
  } else if (spec.k === 'opts') {
    const q = call<QueryLike>(
      optionsModule,
      'usePropertyOptionsQuery',
      () => spec.id
    );
    read = () => observe(q, true);
  } else {
    const q = call<QueryLike>(tagsModule, 'useTagsQuery');
    read = () => observe(q, true);
  }
  const live = props.registry === registry;
  const shown = () => {
    const now = read();
    if (!live || !frozen.has(id)) return now;
    return { ...now, data: frozen.get(id) };
  };
  props.registry.set(id, shown);
  if (live) liveReaders.set(id, read);
  onCleanup(() => {
    props.registry.delete(id);
    if (live) liveReaders.delete(id);
  });
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

type ListLike = QueryLike & { data: unknown[] | undefined };
type DefEntry =
  | { definition: { id: string }; property_options: unknown[] }
  | { id: string };

function Callers(props: { registry: Registry; optionIds: Accessor<string[]> }) {
  // Property panel, PropertyEditorModal, activity, soup actions.
  const allProperties = useAllProperties();
  // Filter bar (next-soup tag filter).
  const filterTags = createTagOptions();
  // CRM deal stages (stage-adapter.ts), with the real team CRM config query.
  const stages = createAppDealStages();
  const list = (params: object) =>
    call<ListLike>(definitionsModule, 'useListPropertiesQuery', () => params);
  // CRM export columns (crm-adapter.ts, mapping copied verbatim).
  const crmExport = list({
    scope: 'all',
    includeOptions: true,
    forEntityType: 'COMPANY',
  });
  // Task board / tasks query / gantt / task-field-source / projects all read
  // system definitions with options.
  const system = list({ scope: 'system', includeOptions: true });
  // Select editor fallback: the entity property's own options come from the
  // all-definitions listing.
  const all = list({ scope: 'all', includeOptions: true });
  // The catalog the callers derive from, read for the runner's tie-order
  // check only (which rows the server sorts as equal); never compared.
  const tags = call<ListLike>(tagsModule, 'useTagsQuery');
  let tagSetsOut: () => unknown = () => null;
  const entries = (q: ListLike) => (q.data ?? []) as DefEntry[];

  // A select editor's options: its own query, or the all-definitions
  // listing's copy while that query has nothing usable.
  const editorOptions = (id: string) => {
    const q = props.registry.get(keyId({ k: 'opts', id }));
    const state = q?.() as Observed | undefined;
    const fallbackEntry = entries(all).find(
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
            isPlaceholderData: !!state.isPlaceholderData,
          },
          fallback as never
        )
      : [];
    return { state, fallback, usable };
  };
  const held = (q: ListLike) => (q.isPending ? null : plain(q.data));

  const read = () => ({
    // Each caller's own list, by name (run.mjs `CALLER_SOURCES`).
    __sources: {
      // What each list holds, kept through a refetch error as its callers
      // keep showing it (only a pending read has nothing).
      all: held(all),
      system: held(system),
      crmExport: held(crmExport),
      tags: held(tags),
      placeholder: {
        all: !!all.isPlaceholderData,
        system: !!system.isPlaceholderData,
        crmExport: !!crmExport.isPlaceholderData,
        tags: !!tags.isPlaceholderData,
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
        entries(crmExport).map((entry) =>
          'definition' in entry
            ? entry
            : { definition: entry, property_options: [] }
        )
      ),
    })),
    taskBoard: safe(() =>
      plain(
        new Map(
          (system.isSuccess ? entries(system) : []).map((item) => {
            const definition = 'definition' in item ? item.definition : item;
            const options =
              'property_options' in item ? item.property_options : [];
            return [
              definition.id,
              toPropertyDefinitionDomain(definition as never, options as never),
            ];
          })
        )
      )
    ),
    projects: safe(() => ({
      loading: system.isPending,
      properties: plain(
        system.isPending
          ? []
          : projectDefinitionProperties(entries(system) as never)
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
const MUTATION_HOOKS: [string, object, string][] = [
  ['createDef', definitionsModule, 'useCreatePropertyDefinitionMutation'],
  ['deleteDef', definitionsModule, 'useDeletePropertyDefinitionMutation'],
  ['addOption', optionsModule, 'useAddPropertyOptionMutation'],
  ['updateOption', optionsModule, 'useUpdatePropertyOptionMutation'],
  ['deleteOption', optionsModule, 'useDeletePropertyOptionMutation'],
  ['ensureTagSet', tagsModule, 'useEnsureTagSetMutation'],
  ['createTag', tagsModule, 'useCreateTagMutation'],
  ['updateTag', tagsModule, 'useUpdatePropertyOptionMutation'],
  ['deleteTag', tagsModule, 'useDeletePropertyOptionMutation'],
  ['promoteTag', tagsModule, 'usePromoteTagMutation'],
  ['mergeTag', tagsModule, 'useMergeTagMutation'],
];

function Mutations(props: { out: (m: Record<string, Wrapped>) => void }) {
  const out: Record<string, Wrapped> = {};
  for (const [name, mod, hook] of MUTATION_HOOKS) {
    const m = call<{ mutateAsync: Wrapped }>(mod, hook);
    out[name] = (vars) => m.mutateAsync(vars as never);
  }
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

// The app installs the normalized cache's host at boot (index.tsx); so does
// this page, before anything reads.
const initCache = exp<() => Promise<void>>(
  soupModule,
  'initializeGraphqlSoupCache'
);
const cacheInit: Promise<string> = initCache
  ? initCache().then(
      () => 'ready',
      (e: unknown) => `failed: ${String((e as Error)?.message ?? e)}`
    )
  : Promise.resolve('absent');

// Toasts the catalog's hooks show, per write: the user-visible half of a
// failure's contract.
type ToastNote = { kind: string; title: string };
let toasts: ToastNote[] = [];
{
  const t = toastModule.toast as unknown as Record<string, unknown>;
  for (const [kind, f] of Object.entries(t)) {
    if (typeof f !== 'function') continue;
    t[kind] = (...args: unknown[]) => {
      const first = args[0];
      toasts.push({
        kind,
        title: typeof first === 'string' ? first : typeof first,
      });
      return (f as (...a: unknown[]) => unknown)(...args);
    };
  }
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

// API fetches as this page saw them, so a settle waits for them and a settle
// timeout separates a request the page sent late from an answer that came
// back late. The wrapper passes every call through unchanged.
type FetchNote = {
  method: string;
  path: string;
  op: string | null;
  start: number;
  end: number | null;
  status: number | null;
  failed?: true;
};
const fetchNotes: FetchNote[] = [];
let fetchesInFlight = 0;
const pageFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  // A note that can't be made is skipped; the call itself always goes through.
  let note: FetchNote | null = null;
  try {
    note = fetchNote(input, init);
  } catch {
    note = null;
  }
  if (note) fetchesInFlight++;
  try {
    const res = await pageFetch(input, init);
    if (note) note.status = res.status;
    return res;
  } catch (e) {
    if (note) note.failed = true;
    throw e;
  } finally {
    if (note) {
      note.end = performance.now();
      fetchesInFlight--;
    }
  }
};
// Only catalog traffic: the properties service and GraphQL.
const CATALOG_PATH = /\/(properties|graphql)(\/|$)/;
function fetchNote(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1]
): FetchNote | null {
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    location.href
  );
  if (!CATALOG_PATH.test(url.pathname)) return null;
  const note: FetchNote = {
    method: (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase(),
    path: url.pathname
      .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '<id>')
      .replace(/[A-Za-z0-9_.~-]{24,}/g, '<token>'),
    op: operationName(init?.body),
    start: performance.now(),
    end: null,
    status: null,
  };
  fetchNotes.push(note);
  if (fetchNotes.length > 60) fetchNotes.shift();
  return note;
}
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
      ...(f.failed ? { failed: true } : {}),
    }));
}

let pendingMutations = 0;

// Busy on either side: a catalog fetch in flight, a reader fetching, a
// harness write pending, or TanStack work.
function busyNow(client: QueryClient, reg: Registry) {
  const out: Record<string, unknown>[] = [];
  if (fetchesInFlight > 0) out.push({ fetches: fetchesInFlight });
  if (pendingMutations > 0) out.push({ harnessWrites: pendingMutations });
  if (client.isFetching() > 0)
    out.push({ queryClientFetching: client.isFetching() });
  if (client.isMutating() > 0)
    out.push({ queryClientMutating: client.isMutating() });
  for (const [id, read] of reg) {
    if (id === 'callers') continue;
    const s = read() as Observed;
    if (
      s.busy.isFetching ||
      (s.busy.fetchStatus && s.busy.fetchStatus !== 'idle')
    )
      out.push({ reader: id, ...s.busy });
  }
  return out;
}

// Settled: nothing busy, and the snapshot unchanged for a quiet window (a
// live query re-evaluates after its fetch ends, and cache pushes arrive with
// no fetch at all).
const QUIET_MS = 150;
async function settle(client: QueryClient, reg: Registry, boundMs: number) {
  const start = performance.now();
  let quietSince = -1;
  let last = '';
  while (performance.now() - start < boundMs) {
    const t = performance.now();
    const snap = JSON.stringify(snapshot(reg));
    const cost = performance.now() - t;
    const idle = busyNow(client, reg).length === 0;
    if (idle && snap === last) {
      if (quietSince < 0) quietSince = performance.now();
      if (performance.now() - quietSince >= QUIET_MS)
        return { ms: Math.round(quietSince - start), timedOut: false };
    } else quietSince = idle ? performance.now() : -1;
    last = snap;
    await sleep(Math.max(30, Math.round(cost * 3)));
  }
  return {
    ms: Math.round(performance.now() - start),
    timedOut: true,
    busy: busyNow(client, reg),
    fetches: fetchesSince(start),
  };
}

function snapshot(reg: Registry) {
  const out: Record<string, unknown> = {};
  for (const [id, read] of reg) out[id] = read();
  return out;
}

type Outcome =
  | { ok: true; value: unknown }
  | {
      ok: false;
      error: ReturnType<typeof errorDetail>;
      message: string;
      cause: unknown;
    };
async function result<T>(f: () => Promise<T>): Promise<Outcome> {
  try {
    return { ok: true, value: plain(await f()) };
  } catch (e) {
    return {
      ok: false,
      error: errorDetail(e),
      message: String((e as Error)?.message ?? e).slice(0, 300),
      cause: e,
    };
  }
}
// What crosses to the runner: never the error object itself.
const sent = (r: Outcome) =>
  r.ok ? r : { ok: false, error: r.error, message: r.message };
const outcome = async <T,>(f: () => Promise<T>) => sent(await result(f));

// A failed write's contract: what the hook's callers branch on. The create
// dialog asks whether a name was reserved, and nothing else asks it, so only
// a failed create answers it; the tag picker and Settings ask for the
// colliding tag of a refused share; the rest is the toasts.
type Conflict = (x: unknown) => {
  message: string;
  conflicting_option: unknown;
} | null;
function failureContract(name: string, e: unknown) {
  const reserved = exp<(x: unknown) => boolean>(
    definitionsModule,
    'isPropertyNameReserved'
  );
  const conflict =
    exp<Conflict>(tagsModule, 'parseTagNameConflict') ??
    exp<Conflict>(propertiesClientModule, 'parseTagNameConflict');
  const c = conflict?.(e) ?? null;
  return {
    reservedName:
      name !== 'createDef'
        ? 'not asked'
        : reserved
          ? reserved(e)
          : 'no predicate',
    tagConflict: c
      ? { message: c.message, conflictingOption: plain(c.conflicting_option) }
      : null,
  };
}

// A new mount: a new, empty QueryClient with the app's defaults, the same
// readers and callers, mounted, settled, read, and torn down. On NEW the
// readers share the page's normalized cache, as a new screen does.
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

// --- the properties service's REST API, called directly ---
// For the runner's own setup and its id view of each world: the same
// requests on both sides, independent of either side's client module.
const propertiesHost: string = SERVER_HOSTS['document-storage-service'];
type RestOp = {
  method: 'GET' | 'POST';
  path: (a: Record<string, unknown>) => string;
  body?: (a: Record<string, unknown>) => unknown;
};
const REST: Record<string, RestOp> = {
  createPropertyDefinition: {
    method: 'POST',
    path: () => '/properties/definitions',
    body: (a) => a.body,
  },
  addPropertyOption: {
    method: 'POST',
    path: (a) => `/properties/definitions/${a.definition_id}/options`,
    body: (a) => a.body,
  },
  ensureTagSet: {
    method: 'POST',
    path: () => '/properties/tags',
    body: (a) => a.body,
  },
  listProperties: {
    method: 'GET',
    path: (a) => {
      const q = new URLSearchParams();
      q.set('scope', String(a.scope));
      if (a.include_options !== undefined)
        q.set('include_options', String(a.include_options));
      if (a.for_entity_type)
        q.set('for_entity_type', String(a.for_entity_type));
      return `/properties/definitions?${q}`;
    },
  },
  listTags: { method: 'GET', path: () => '/properties/tags' },
};
function rest(op: string, args: Record<string, unknown> = {}) {
  const spec = REST[op];
  if (!spec) throw new Error(`harness: no REST op ${op}`);
  return throwOnErr(() =>
    fetchWithToken<never>(`${propertiesHost}${spec.path(args)}`, {
      method: spec.method,
      ...(spec.body ? { body: JSON.stringify(spec.body(args)) } : {}),
    })
  );
}

// --- NEW's own reads, straight from the server ---
// The head's GraphQL documents over the fetch-only client (no normalized
// cache, so a raw read never refreshes what a live reader shows), mapped by
// the head's own mapping, as the readers map them.
type CatalogMap = typeof import('@queries/properties/catalog/map');
let catalogMap: CatalogMap | null = null;
const headMap = async () => {
  catalogMap ??= await import('@queries/properties/catalog/map');
  return catalogMap;
};
const doc = (name: string) => {
  const d = Reflect.get(graphqlModule, name);
  if (!d) throw new Error(`harness: no document ${name} on this side`);
  return d as never;
};
type GqlClient = {
  query: (
    d: never,
    v: unknown,
    o: unknown
  ) => { toPromise(): Promise<{ data?: unknown; error?: unknown }> };
};
async function gql(docName: string, variables: Record<string, unknown>) {
  const client = call<GqlClient>(soupModule, 'getGraphqlSoupNetworkClient');
  const res = await client
    .query(doc(docName), variables, { requestPolicy: 'network-only' })
    .toPromise();
  if (res.error) throw res.error;
  if (!res.data) throw new Error(`${docName} returned no data`);
  return res.data as { user: Record<string, unknown> };
}
type ListArgs = {
  scope: string;
  includeOptions: boolean;
  forEntityType?: string;
};
const neuRaw = {
  async list(a: ListArgs) {
    const m = await headMap();
    const variables = {
      scope: m.toGraphqlDefinitionScope(a.scope as never),
      forEntityType: a.forEntityType ?? null,
    };
    const data = await gql(
      a.includeOptions
        ? 'PropertyCatalogDefinitionsWithOptionsDocument'
        : 'PropertyCatalogDefinitionsDocument',
      variables
    );
    const defs = data.user.propertyDefinitions as never[];
    return a.includeOptions
      ? defs.flatMap((d) => m.toDefinitionWithOptions(d) ?? [])
      : defs.flatMap((d) => m.toPropertyDefinition(d) ?? []);
  },
  async options(id: string) {
    const m = await headMap();
    const data = await gql('PropertyCatalogOptionsDocument', {
      propertyDefinitionId: id,
    });
    return m.toPropertyOptions(data.user.propertyOptions as never);
  },
  async tags() {
    const m = await headMap();
    const data = await gql('PropertyCatalogTagSetsDocument', {});
    return (data.user.tagSets as never[]).flatMap((s) => m.toTagSet(s) ?? []);
  },
};

// --- NEW's normalized cache, for the stale-cache mutant ---
type CacheQuery = {
  query: string;
  operationName: string;
  variables: Record<string, unknown>;
};
type CacheHost = {
  readQuery(
    a: CacheQuery
  ): Promise<{ kind: 'hit'; data: unknown } | { kind: 'miss' }>;
  writeQuery(a: CacheQuery & { generation: string; data: unknown }): Promise<unknown>;
};
const cacheHost = () =>
  exp<() => CacheHost | undefined>(soupModule, 'getGraphqlSoupCacheHost')?.();
// The document and variables an open reader reads, by its key.
async function readerQuery(spec: Key): Promise<CacheQuery> {
  const m = await headMap();
  if (spec.k === 'defs') {
    const name = spec.includeOptions
      ? 'PropertyCatalogDefinitionsWithOptions'
      : 'PropertyCatalogDefinitions';
    return {
      query: stringifyDocument(doc(`${name}Document`)),
      operationName: name,
      variables: {
        scope: m.toGraphqlDefinitionScope(spec.scope as never),
        forEntityType: spec.forEntityType ?? null,
      },
    };
  }
  const [name, variables] =
    spec.k === 'opts'
      ? ['PropertyCatalogOptions', { propertyDefinitionId: spec.id }]
      : ['PropertyCatalogTagSets', {}];
  return {
    query: stringifyDocument(doc(`${name}Document`)),
    operationName: name,
    variables,
  };
}
let staleCache: { id: string; q: CacheQuery; data: unknown }[] = [];
const dataOf = (id: string) =>
  JSON.stringify(liveReaders.get(id)?.().data ?? null);

declare global {
  interface Window {
    __h: unknown;
    __harnessReady: boolean;
  }
}

// Which side each changed module on this page came from: the runner checks
// that OLD runs the base commit's copies (run.sh marks them) and NEW the head's.
const SIDE_MODULES: [string, object][] = [
  ['queries/properties/definitions', definitionsModule],
  ['queries/properties/options', optionsModule],
  ['queries/properties/tags', tagsModule],
  ['queries/properties/keys', keysModule],
  ['service-properties/client', propertiesClientModule],
  ['service-storage/graphql/generated/graphql', graphqlModule],
];
const restClient = () =>
  Reflect.get(propertiesClientModule, 'propertiesServiceClient') as object;

window.__h = {
  setKeys(keys: Key[]) {
    setOpenKeys(keys);
  },
  settle: (boundMs = 5000) => settle(queryClient, registry, boundMs),
  snapshot: () => snapshot(registry),
  fresh,
  // The same-user load's reads (`startSameUserLoad` in run.mjs): the whole
  // catalog as the head's readers and main's REST client ask for it. The
  // runner sends them from outside the page, so a settle here never waits on
  // them.
  async loadRequests() {
    const graphql = new URL(`${propertiesHost}/items/soup/graphql`, location.href).href;
    const rest = (op: string, args: Record<string, unknown>) =>
      new URL(`${propertiesHost}${REST[op].path(args)}`, location.href).href;
    const query = async (key: Key) => JSON.stringify(await readerQuery(key));
    return [
      { method: 'POST', url: graphql, body: await query({ k: 'defs', scope: 'all', includeOptions: true }) },
      { method: 'GET', url: rest('listProperties', { scope: 'all', include_options: true }) },
      { method: 'POST', url: graphql, body: await query({ k: 'tags' }) },
      { method: 'GET', url: rest('listTags', {}) },
    ];
  },
  async mutate(name: string, vars: unknown) {
    const m = mutations[name];
    toasts = [];
    if (!m) return { ok: false, contract: { harness: `no ${name}` }, toasts };
    pendingMutations++;
    let r: Outcome;
    try {
      r = await result(() => m(vars));
    } finally {
      pendingMutations--;
    }
    // a hook's toast lands before its promise settles; one more turn for
    // anything it scheduled
    await sleep(0);
    const shown = toasts;
    toasts = [];
    if (r.ok) return { ok: true, value: r.value, toasts: shown };
    return {
      ok: false,
      contract: failureContract(name, r.cause),
      toasts: shown,
      error: r.error,
      message: r.message,
    };
  },
  authenticated: () => authenticated(),
  cacheState: async () => ({
    init: await cacheInit,
    host: cacheHost() !== undefined,
  }),
  moduleSides: () =>
    Object.fromEntries(
      SIDE_MODULES.map(([name, mod]) => [
        name,
        Reflect.get(mod, '__PROOF_MODULE__') ?? 'head',
      ])
    ),
  // The property editor's imperative read after it creates a definition.
  imperative: {
    fetchDefinitionWithOptions: (id: string) =>
      outcome(
        () =>
          call(
            definitionsModule,
            'fetchPropertyDefinitionWithOptions',
            id
          ) as Promise<unknown>
      ),
  },
  mutant: {
    // skip-live-update: freeze every open reader at what it shows now; the
    // write's live update then never reaches it.
    freeze() {
      frozen.clear();
      for (const [id, read] of liveReaders) frozen.set(id, read().data);
    },
    // The readers the freeze kept from changing, with the data each shows.
    takeFrozen() {
      const readers: { id: string; data: unknown }[] = [];
      for (const [id, data] of frozen)
        if (dataOf(id) !== JSON.stringify(data ?? null))
          readers.push({ id, data });
      return { count: readers.length, readers };
    },
    // Back to live: the next step starts from what the cache holds.
    release() {
      frozen.clear();
    },
    // stale-cache: what the cache holds for every open reader before a write,
    // put back after the page settles, as a cache that missed the write.
    async takeCache() {
      const host = cacheHost();
      staleCache = [];
      if (!host) return { host: false, taken: 0 };
      for (const id of liveReaders.keys()) {
        const q = await readerQuery(JSON.parse(id) as Key);
        const hit = await host.readQuery(q);
        if (hit.kind === 'hit') staleCache.push({ id, q, data: hit.data });
      }
      return { host: true, taken: staleCache.length };
    },
    // Writes back what changed since, then waits until each reader shows it.
    // Returns the readers it changed, with the data each shows then.
    async restoreCache() {
      const host = cacheHost();
      const taken = staleCache;
      staleCache = [];
      if (!host) return { restored: 0, readers: [] };
      const gen = await import('@graphql-cache/session-generation');
      const generation = gen.cacheSessionGeneration.capture();
      const before = new Map<string, string>();
      for (const t of taken) {
        const now = await host.readQuery(t.q);
        if (
          now.kind === 'hit' &&
          JSON.stringify(now.data) === JSON.stringify(t.data)
        )
          continue;
        before.set(t.id, dataOf(t.id));
        await host.writeQuery({ generation, ...t.q, data: t.data });
      }
      const deadline = performance.now() + 3000;
      const unchanged = () =>
        [...before].some(([id, was]) => dataOf(id) === was);
      while (performance.now() < deadline && unchanged()) await sleep(20);
      await settle(queryClient, registry, 3000);
      const readers = [...before]
        .filter(([id, was]) => dataOf(id) !== was)
        .map(([id]) => ({ id, data: liveReaders.get(id)?.().data }));
      return { restored: readers.length, readers };
    },
  },
  raw: {
    // OLD's queryFns: main's REST client, as its readers call it.
    old: {
      list: (a: ListArgs) =>
        outcome(() =>
          throwOnErr(
            () =>
              call(restClient(), 'listProperties', {
                scope: a.scope,
                include_options: a.includeOptions,
                for_entity_type: a.forEntityType,
              }) as never
          )
        ),
      options: (id: string) =>
        outcome(() =>
          throwOnErr(
            () =>
              call(restClient(), 'getPropertyOptions', {
                definition_id: id,
              }) as never
          )
        ),
      tags: () =>
        outcome(() =>
          throwOnErr(() => call(restClient(), 'listTags') as never)
        ),
    },
    neu: {
      list: (a: ListArgs) => outcome(() => neuRaw.list(a)),
      options: (id: string) => outcome(() => neuRaw.options(id)),
      tags: () => outcome(() => neuRaw.tags()),
    },
  },
  // The runner's own writes and reads (accounts, teams, ids); never compared.
  setup: {
    rest: (op: string, args: Record<string, unknown>) =>
      outcome(() => rest(op, args)),
    // What this account can see, by REST: the runner's id view of its world.
    catalog: async () => {
      const [defs, tags] = await Promise.all([
        outcome(() =>
          rest('listProperties', { scope: 'all', include_options: true })
        ),
        outcome(() => rest('listTags')),
      ]);
      return { defs, tags };
    },
    auth: (op: string, ...args: unknown[]) =>
      outcome(() =>
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
