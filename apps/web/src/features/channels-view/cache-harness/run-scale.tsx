/**
 * One Chat account through the real cache, measured as two page loads:
 *
 * 1. `seedChatCache` is the earlier visit. It runs the channel backfill lane
 *    and opens Chat once, so the cache files hold what a returning viewer's
 *    do, then ends the page.
 * 2. `measureChat` is the next load over those files, in a fresh module graph
 *    (the caller resets modules between the two): the app shell's channel
 *    directory, then Chat, then one unrelated cache write, one message in one
 *    channel, and a section expanded then collapsed. Each step is counted on
 *    its own once the work it started has settled.
 *
 * The app's modules reach the harness's client, host and fixture through the
 * mocks in `chat.harness.tsx` (`harness-state.ts`).
 */
import { ChannelDirectoryProvider } from '@core/context/channels';
import {
  createFixtureNetwork,
  type FixtureNetwork,
} from '@graphql-cache/headless/fixture-network';
import type {
  MemoryOpfs,
  MemoryOpfsCounters,
} from '@graphql-cache/headless/memory-opfs';
import type {
  SqlCounters,
  ViewReads,
} from '@graphql-cache/headless/real-engine';
import {
  type HeadlessCacheRuntime,
  installHeadlessCacheRuntime,
} from '@graphql-cache/headless/runtime';
import {
  countSolidAllocations,
  type SolidAllocationCounter,
  type SolidAllocations,
} from '@graphql-cache/headless/solid-allocations';
import type { CacheHost } from '@graphql-cache/host/types';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import { authKeys } from '@queries/auth/keys';
import { createAppChannelDirectory } from '@queries/channel/directory';
import { queryClient } from '@queries/client';
import {
  CHANNEL_SOUP_BACKFILL_LANE,
  runSoupBackfillToCompletion,
} from '@queries/soup/backfill';
import { ACCOUNT_WIDE_REFRESH_INTERVAL_MS } from '@queries/visible-refresh';
import { createGraphqlSoupSubscriptionsLifecycle } from '@service-storage/graphql-soup-websocket';
import { QueryClientProvider } from '@tanstack/solid-query';
import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import type { ChannelsRailSection } from '../types';
import {
  type ChatFixture,
  FIXTURE_NOW,
  type FixtureReads,
  VIEWER_ID,
} from './fixture';
import { clearMappedRows, harnessState } from './harness-state';
import {
  type ChatDataPath,
  ChatDataPathMount,
  type SectionRange,
} from './mount';
import { createHarnessClients } from './soup-client';

/** Both loads open the same cache scope, as one browser profile does. */
const CACHE_SCOPE = 'chat-cache-harness';
/** Work has settled once nothing moved for this long: longer than the widest
 * coalescing window on the Chat path, the channel directory's refresh spacing
 * (`ACCOUNT_WIDE_REFRESH_INTERVAL_MS`, 2 s). A shorter wait lets the refresh a
 * step caused land in the next step. */
const QUIET_MS = ACCOUNT_WIDE_REFRESH_INTERVAL_MS + 500;
const POLL_MS = 20;
const SETTLE_LIMIT_MS = 120_000;
/** Bounds the "Show more" rounds a cold open makes for the viewport. */
const LOAD_MORE_ROUNDS = 20;
/** The section the expand and collapse scenarios toggle. */
const TOGGLED_SECTION: ChannelsRailSection = 'channels';

export const SCENARIOS = [
  'appShell',
  'chatOpen',
  'unrelatedWrite',
  'message',
  'expand',
  'collapse',
] as const;
export type ScenarioName = (typeof SCENARIOS)[number];

export type RowCounts = {
  /** Rows the rail built: headings, conversations, favorites, statuses. */
  built: number;
  /** Conversation and favorite rows the rail resolved to a channel. */
  resolved: number;
  /** Rows the sidebar's virtualizers mount for the fixed viewport. */
  rendered: number;
  /** What each open section reports for the viewport. */
  ranges: SectionRange[];
};

/** A mapper's work in one step: every call, the calls that built a result
 * rather than returning a memoized one, the calls that walked a store proxy
 * inside a tracking scope, and the distinct rows mapped. A row mapped more
 * than once in a step was mapped again for a later emission. */
export type MapperWork = {
  calls: number;
  built: number;
  trackedWalks: number;
  rows: number;
};

export type ScenarioCounts = {
  /** Engine method calls (every dispatch into cache-wasm), by method. */
  engine: {
    calls: number;
    byMethod: Record<string, number>;
    recordsOut: number;
    /** Reads for views (queries, filters, searches by their inputs). */
    views: ViewReads;
  };
  sql: SqlCounters;
  opfs: MemoryOpfsCounters;
  network: { operations: Record<string, number>; frames: number };
  /** What the fixture server served for those operations. */
  server: Omit<FixtureReads, 'unsupported'>;
  mappers: Record<string, MapperWork>;
  solid: SolidAllocations;
  /** Solid allocations divided by `rows.resolved` after the step. */
  solidPerResolvedRow: SolidAllocations;
  rows: RowCounts;
  /** From the step's start to the last work it caused. Not a browser
   * timing: workers share one event loop here. */
  wallMs: number;
};

export type ChatScaleResult = {
  channels: number;
  scenarios: Record<ScenarioName, ScenarioCounts>;
  seed: {
    wallMs: number;
    engineCalls: number;
    sql: SqlCounters;
    fileBytes: number;
  };
  /** Anything here means the run did not measure what it says. */
  faults: {
    networkErrors: string[];
    unsupportedReads: string[];
    escapes: string[];
    initializationErrors: string[];
  };
  openSubscriptions: Record<string, number>;
  /** The channel the message scenario delivers to. */
  messageChannelId: string;
};

type Graph = {
  runtime: HeadlessCacheRuntime;
  host: CacheHost;
  network: FixtureNetwork;
  fixture: ChatFixture;
  dispose(): Promise<void>;
};

async function openGraph(
  fixture: ChatFixture,
  reopen?: MemoryOpfs
): Promise<Graph> {
  const runtime = await installHeadlessCacheRuntime({ reopen });
  const host = runtime.openHost(CACHE_SCOPE);
  const authority = await host.authority?.current();
  if (!authority) throw new Error('The harness host has no cache authority');
  // crm-access-cache.ts does this when the owner's first baseline arrives.
  cacheSessionGeneration.initialize(authority.generation);
  const network = createFixtureNetwork(() => fixture.rootValue());
  const clients = createHarnessClients(host, network);
  const state = harnessState();
  state.client = clients.client;
  state.networkClient = clients.networkClient;
  state.host = host;
  queryClient.setQueryData(authKeys.userInfo.queryKey, {
    id: VIEWER_ID,
    authenticated: true,
  });
  const subscriptions = createGraphqlSoupSubscriptionsLifecycle();
  subscriptions.replace(clients.client, host);
  return {
    runtime,
    host,
    network,
    fixture,
    async dispose() {
      subscriptions.dispose();
      queryClient.clear();
      clients.dispose();
      state.client = undefined;
      state.networkClient = undefined;
      state.host = undefined;
      await runtime.dispose();
    },
  };
}

type ChatView = {
  showShell(): void;
  showChat(): void;
  path(): ChatDataPath | undefined;
  dispose(): void;
};

/** The app shell's channel directory and, under it, Chat's data path. */
function mountChat(onRange?: (range: SectionRange) => void): ChatView {
  const [shell, setShell] = createSignal(false);
  const [chat, setChat] = createSignal(false);
  let path: ChatDataPath | undefined;
  const container = document.createElement('div');
  const dispose = render(
    () => (
      <QueryClientProvider client={queryClient}>
        <Show when={shell()}>
          <ChannelDirectoryProvider directory={createAppChannelDirectory()}>
            <Show when={chat()}>
              <ChatDataPathMount
                onReady={(ready) => {
                  path = ready;
                }}
                onSectionRange={onRange}
              />
            </Show>
          </ChannelDirectoryProvider>
        </Show>
      </QueryClientProvider>
    ),
    container
  );
  return {
    showShell: () => setShell(true),
    showChat: () => setChat(true),
    path: () => path,
    dispose: () => {
      dispose();
      path = undefined;
    },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Waits until no engine call, request or query is open and nothing new
 * started for `QUIET_MS`; resolves with the time to the last change. */
async function settle(graph: Graph): Promise<number> {
  const started = performance.now();
  const activity = () => {
    const calls = graph.runtime.engine.log.calls;
    const open = calls.filter((call) => call.recordsOut === undefined).length;
    return {
      key: `${calls.length}:${graph.network.log.operations.length}:${graph.network.log.frames.length}`,
      busy:
        open > 0 ||
        graph.network.log.inFlight() > 0 ||
        queryClient.isFetching() > 0 ||
        queryClient.isMutating() > 0,
    };
  };
  let last = activity().key;
  let lastChange = performance.now();
  while (performance.now() - started < SETTLE_LIMIT_MS) {
    await delay(POLL_MS);
    const now = activity();
    if (now.busy || now.key !== last) {
      last = now.key;
      lastChange = performance.now();
      continue;
    }
    if (performance.now() - lastChange >= QUIET_MS) return lastChange - started;
  }
  throw new Error(`Chat work did not settle within ${SETTLE_LIMIT_MS} ms`);
}

/** Asks for "Show more" wherever a status row is in view, as `BrowseSection`
 * does, until the viewport needs nothing more. */
async function loadViewport(graph: Graph, view: ChatView): Promise<void> {
  for (let round = 0; round < LOAD_MORE_ROUNDS; round += 1) {
    const asked = view.path()?.loadVisibleSections() ?? [];
    if (asked.length === 0) return;
    await settle(graph);
  }
}

type Snapshot = {
  engineMark: number;
  sql: SqlCounters;
  opfs: MemoryOpfsCounters;
  networkMark: number;
  frames: number;
  reads: FixtureReads;
  mappers: Record<string, Omit<MapperWork, 'rows'>>;
  solid: SolidAllocations;
};

function snapshot(graph: Graph, solid: SolidAllocationCounter): Snapshot {
  return {
    engineMark: graph.runtime.engine.log.mark(),
    sql: graph.runtime.engine.sqlCounters(),
    opfs: { ...graph.runtime.opfs.counters },
    networkMark: graph.network.log.mark(),
    frames: graph.network.log.frames.length,
    reads: graph.fixture.reads(),
    mappers: Object.fromEntries(
      Object.entries(harnessState().mappers).map(([name, counter]) => [
        name,
        {
          calls: counter.calls,
          built: counter.built,
          trackedWalks: counter.trackedWalks,
        },
      ])
    ),
    solid: solid.read(),
  };
}

function rowCounts(path: ChatDataPath | undefined): RowCounts {
  if (!path) return { built: 0, resolved: 0, rendered: 0, ranges: [] };
  const rows = path.rows();
  const viewport = path.viewport();
  return {
    built: rows.length,
    resolved: rows.filter(
      (row) => row.kind === 'conversation' || row.kind === 'favorite'
    ).length,
    rendered: viewport.renderedRows,
    ranges: viewport.ranges,
  };
}

function perRow(solid: SolidAllocations, rows: number): SolidAllocations {
  const per = (value: number) =>
    rows === 0 ? 0 : Math.round((value / rows) * 100) / 100;
  return {
    owners: per(solid.owners),
    signals: per(solid.signals),
    storeNodes: per(solid.storeNodes),
  };
}

async function measureStep(
  graph: Graph,
  view: ChatView,
  solid: SolidAllocationCounter,
  step: () => Promise<void> | void
): Promise<ScenarioCounts> {
  const before = snapshot(graph, solid);
  clearMappedRows();
  const started = performance.now();
  await step();
  const settleStarted = performance.now();
  const wallMs = settleStarted - started + (await settle(graph));
  const engine = graph.runtime.engine;
  const sql = engine.sqlCounters();
  const opfs = graph.runtime.opfs.counters;
  const reads = graph.fixture.readsSince(before.reads);
  const mappers: Record<string, MapperWork> = {};
  for (const [name, counter] of Object.entries(harnessState().mappers)) {
    const calls = counter.calls - (before.mappers[name]?.calls ?? 0);
    if (calls === 0) continue;
    mappers[name] = {
      calls,
      built: counter.built - (before.mappers[name]?.built ?? 0),
      trackedWalks:
        counter.trackedWalks - (before.mappers[name]?.trackedWalks ?? 0),
      rows: counter.ids.size,
    };
  }
  const allocated = solid.since(before.solid);
  const rows = rowCounts(view.path());
  const byMethod = engine.log.countsSince(before.engineMark);
  return {
    engine: {
      calls: Object.values(byMethod).reduce((total, count) => total + count, 0),
      byMethod,
      recordsOut: engine.log.recordsOutSince(before.engineMark),
      views: engine.log.viewReadsSince(before.engineMark),
    },
    sql: {
      statements: sql.statements - before.sql.statements,
      rows: sql.rows - before.sql.rows,
    },
    opfs: {
      reads: opfs.reads - before.opfs.reads,
      writes: opfs.writes - before.opfs.writes,
      bytesRead: opfs.bytesRead - before.opfs.bytesRead,
      bytesWritten: opfs.bytesWritten - before.opfs.bytesWritten,
      flushes: opfs.flushes - before.opfs.flushes,
    },
    network: {
      operations: graph.network.log.countsSince(before.networkMark),
      frames: graph.network.log.frames.length - before.frames,
    },
    server: {
      fields: reads.fields,
      rowsRequested: reads.rowsRequested,
      idsRequested: reads.idsRequested,
      rowsReturned: reads.rowsReturned,
    },
    mappers,
    solid: allocated,
    solidPerResolvedRow: perRow(allocated, rows.resolved),
    rows,
    wallMs: Math.round(wallMs),
  };
}

/** The earlier visit: the channel lane's backfill and one open of Chat.
 * Returns the origin to load the measured page over. */
export async function seedChatCache(fixture: ChatFixture): Promise<{
  opfs: MemoryOpfs;
  seed: ChatScaleResult['seed'];
  faults: string[];
}> {
  const started = performance.now();
  const graph = await openGraph(fixture);
  await runSoupBackfillToCompletion(VIEWER_ID, graph.host, {
    ...CHANNEL_SOUP_BACKFILL_LANE,
    pageDelayMs: 0,
  });
  const view = mountChat();
  view.showShell();
  await settle(graph);
  view.showChat();
  await settle(graph);
  await loadViewport(graph, view);
  view.dispose();
  const faults = [
    ...graph.network.log.errors,
    ...graph.runtime.initializationErrors.map(String),
  ];
  const engineCalls = graph.runtime.engine.log.calls.length;
  const sql = graph.runtime.engine.sqlCounters();
  await graph.dispose();
  const fileBytes = Object.values(graph.runtime.opfs.root.fileSizes()).reduce(
    (total, size) => total + size,
    0
  );
  return {
    opfs: graph.runtime.opfs,
    seed: {
      wallMs: Math.round(performance.now() - started),
      engineCalls,
      sql,
      fileBytes,
    },
    faults,
  };
}

const UNRELATED_WRITE = `query CacheHarnessUnrelatedWrite($input: SoupEntityInput!) {
  user {
    __typename
    id
    soupEntity(input: $input) {
      __typename
      id
      entityType
      ... on GraphqlSoupDocument {
        name
        updatedAt
      }
    }
  }
}`;

/** A channel outside favorites and sections, among the channels N and 2N
 * share, so both sizes deliver to the same one. */
function messageChannel(fixture: ChatFixture): string {
  const favorites = new Set(fixture.favoriteChannelIds);
  const sectioned = new Set(
    (['team', 'personal'] as const).flatMap((scope) =>
      fixture.labels(scope).labels.flatMap((label) => label.channelIds)
    )
  );
  const channel = fixture.channels
    .slice(1_000)
    .find(
      (candidate) =>
        (candidate.channelType === 'public' ||
          candidate.channelType === 'private') &&
        !favorites.has(candidate.id) &&
        !sectioned.has(candidate.id)
    );
  if (!channel) throw new Error('The fixture has no channel to message');
  return channel.id;
}

/** The measured load over `opfs`; see the module comment. */
export async function measureChat(
  fixture: ChatFixture,
  opfs: MemoryOpfs,
  seed: ChatScaleResult['seed'],
  seedFaults: string[]
): Promise<ChatScaleResult> {
  const solid = countSolidAllocations();
  const graph = await openGraph(fixture, opfs);
  const view = mountChat();
  const scenarios = {} as Record<ScenarioName, ScenarioCounts>;
  const messageChannelId = messageChannel(fixture);
  try {
    scenarios.appShell = await measureStep(graph, view, solid, () =>
      view.showShell()
    );
    scenarios.chatOpen = await measureStep(graph, view, solid, async () => {
      view.showChat();
      await settle(graph);
      await loadViewport(graph, view);
    });
    scenarios.unrelatedWrite = await measureStep(
      graph,
      view,
      solid,
      async () => {
        const authority = await graph.host.authority?.current();
        await graph.host.writeQuery({
          generation: authority?.generation ?? '',
          query: UNRELATED_WRITE,
          operationName: 'CacheHarnessUnrelatedWrite',
          variables: {
            input: {
              entityType: 'DOCUMENT',
              entityId: 'cache-harness-document',
            },
          },
          data: {
            user: {
              __typename: 'GraphqlUser',
              id: VIEWER_ID,
              soupEntity: {
                __typename: 'GraphqlSoupDocument',
                id: 'cache-harness-document',
                entityType: 'DOCUMENT',
                name: 'Unrelated document',
                updatedAt: new Date(FIXTURE_NOW).toISOString(),
              },
            },
          },
          identity: VIEWER_ID,
        });
      }
    );
    scenarios.message = await measureStep(graph, view, solid, async () => {
      const frames = fixture.deliverMessage(
        messageChannelId,
        FIXTURE_NOW + 60_000
      );
      await graph.network.push('SoupUpdates', frames.SoupUpdates);
      await graph.network.push(
        'NotificationUpdates',
        frames.NotificationUpdates
      );
    });
    // Expand from collapsed, then collapse again; the setup collapse is not
    // counted.
    view.path()?.setExpanded(TOGGLED_SECTION, false);
    await settle(graph);
    scenarios.expand = await measureStep(graph, view, solid, async () => {
      view.path()?.setExpanded(TOGGLED_SECTION, true);
      await settle(graph);
      await loadViewport(graph, view);
    });
    scenarios.collapse = await measureStep(graph, view, solid, () =>
      view.path()?.setExpanded(TOGGLED_SECTION, false)
    );
    return {
      channels: fixture.channels.length,
      scenarios,
      seed,
      faults: {
        networkErrors: [...seedFaults, ...graph.network.log.errors],
        unsupportedReads: fixture.reads().unsupported,
        escapes: [...harnessState().escapes],
        initializationErrors: graph.runtime.initializationErrors.map(String),
      },
      openSubscriptions: graph.network.log.openSubscriptions(),
      messageChannelId,
    };
  } finally {
    view.dispose();
    solid.dispose();
    await graph.dispose();
  }
}
