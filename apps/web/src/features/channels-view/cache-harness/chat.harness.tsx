/**
 * Chat's sidebar data path over the real cache engine at N and 2N channels:
 * see `run-scale.tsx` for the scenarios and `AGENTS.md` for the counts.
 * Writes every count to `CHAT_CACHE_HARNESS_OUT` (default
 * `apps/web/.cache/chat-cache-harness/results.json`) before it checks the run
 * was faithful.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type * as Posthog from '@app/lib/analytics/posthog';
import type * as GlobalAppState from '@components/app/GlobalAppState';
import type * as UserContext from '@core/context/user';
import type * as DirectoryCore from '@queries/channel/directory-core';
import type * as ListEntity from '@queries/channel/list-entity';
import type * as TransformUtils from '@queries/soup/transform-utils';
import type * as StorageClient from '@service-storage/client';
import type * as GraphqlSoup from '@service-storage/graphql-soup';
import { ok } from 'neverthrow';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createChatFixture } from './fixture';
import { gatedRun, gateFailures, readBaseline, writeBaseline } from './gate';
import { harnessState, setHarnessState } from './harness-state';
import type * as RunScale from './run-scale';

const SIZES = [3_500, 7_000] as const;
const FIXTURE_SEED = 1;
/** The flags Chat's redesigned sidebar runs with; every other flag is off. */
const FLAGS_ON = ['enable-channel-tags', 'enable-chat-sidebar-sections'];
const RESULTS_PATH = resolve(
  process.env.CHAT_CACHE_HARNESS_OUT ?? '.cache/chat-cache-harness/results.json'
);

vi.mock('@core/context/user', async (importOriginal) => {
  const original = await importOriginal<typeof UserContext>();
  const { VIEWER_ID } = await import('./fixture');
  return {
    ...original,
    useUserId: () => () => VIEWER_ID,
    useIsAuthenticated: () => () => true,
    useEmail: () => () => 'viewer@example.test',
  };
});

vi.mock('@app/lib/analytics/posthog', async (importOriginal) => {
  const original = await importOriginal<typeof Posthog>();
  const { harnessState } = await import('./harness-state');
  return {
    ...original,
    useFeatureFlag: (flag: string | { key: string }) => {
      const key = typeof flag === 'string' ? flag : flag.key;
      const enabled = FLAGS_ON.includes(key);
      harnessState().flags[key] = enabled;
      return () => ({ enabled, payload: undefined, loading: false });
    },
  };
});

// The rail's section lists come from REST, not the cache.
vi.mock('@service-storage/client', async (importOriginal) => {
  const original = await importOriginal<typeof StorageClient>();
  const { harnessState } = await import('./harness-state');
  const list = async (scope?: string) =>
    ok(harnessState().fixture.labels(scope));
  const client = original.storageServiceClient;
  return {
    ...original,
    storageServiceClient: {
      ...client,
      channelLabels: { ...client.channelLabels, list },
      channelSections: { ...client.channelSections, list },
    },
  };
});

// The sidebar mounts no notification feed: GraphQL rows carry their own
// unread edge, and the legacy feed only fills rows without one.
vi.mock('@components/app/GlobalAppState', async (importOriginal) => {
  const original = await importOriginal<typeof GlobalAppState>();
  return {
    ...original,
    useGlobalNotificationSource: () => ({
      notifications: () => [],
      notificationsByEntity: () => ({}),
      mutedEntities: () => [],
      isLoading: () => false,
      isEnabled: () => true,
      withLocalState: undefined,
      subscribe: () => () => {},
    }),
  };
});

vi.mock('../components/rail/hooks/useChannelCalls', () => ({
  useChannelCalls: () => ({
    callActivity: () => [],
    incomingCallIds: () => new Map(),
    callStatuses: () => new Map(),
  }),
}));

// The app's Soup module reads its own client and host; point it at the
// harness's. Its fetch and hydration run over the harness's client
// (`queryGraphqlSoupData`, `hydrateGraphqlSoupWith`), and mapping goes through
// the counted mapper: the module's own calls to `mapGraphqlSoupItem` are not
// mockable.
vi.mock('@service-storage/graphql-soup', async (importOriginal) => {
  const original = await importOriginal<typeof GraphqlSoup>();
  const { countMapper, harnessState } = await import('./harness-state');
  const client = () => {
    const current = harnessState().client;
    if (!current) throw new Error('The harness has no Soup client');
    return current;
  };
  const mapGraphqlSoupItem = (
    ...args: Parameters<typeof original.mapGraphqlSoupItem>
  ) =>
    countMapper('mapGraphqlSoupItem', [args[0]], () =>
      original.mapGraphqlSoupItem(...args)
    );
  // `mapGraphqlSoupPage`, over the counted item mapper.
  const mapGraphqlSoupPage: typeof original.mapGraphqlSoupPage = (data) => ({
    items: data.user.soup.items
      .map((item) => mapGraphqlSoupItem(item))
      .filter((item) => item !== null),
    next_cursor: data.user.soup.nextCursor ?? undefined,
  });
  const fetchGraphqlSoup: typeof original.fetchGraphqlSoup = async (
    document,
    variables,
    options = {}
  ) =>
    mapGraphqlSoupPage(
      await original.queryGraphqlSoupData(
        client(),
        true,
        document,
        variables,
        options
      )
    );
  const hydrateGraphqlSoup: typeof original.hydrateGraphqlSoup = (
    document,
    variables,
    options
  ) => original.hydrateGraphqlSoupWith(client(), document, variables, options);
  return {
    ...original,
    getGraphqlSoupClient: client,
    getEntityGraphqlClient: client,
    getGraphqlSoupNetworkClient: () => {
      const current = harnessState().networkClient;
      if (!current) throw new Error('The harness has no network client');
      return current;
    },
    getGraphqlSoupCacheHost: () => harnessState().host,
    getGraphqlCacheHost: () => harnessState().host,
    hasGraphqlCacheHost: () => harnessState().host !== undefined,
    graphqlCacheEnabled: () => harnessState().host !== undefined,
    graphqlSoupProjectionSupported: () => true,
    graphqlDraftQueueBlocked: () => false,
    mapGraphqlSoupItem,
    mapGraphqlSoupPage,
    fetchGraphqlSoup,
    hydrateGraphqlSoup,
    fetchGraphqlGroupedSoup: () => {
      throw new Error('Grouped Soup is not on the Chat sidebar path');
    },
  };
});

vi.mock('@queries/channel/list-entity', async (importOriginal) => {
  const original = await importOriginal<typeof ListEntity>();
  const { countMapper } = await import('./harness-state');
  return {
    ...original,
    mapChannelToEntity: (
      ...args: Parameters<typeof original.mapChannelToEntity>
    ) =>
      countMapper('mapChannelToEntity', [args[0].channel], () =>
        original.mapChannelToEntity(...args)
      ),
  };
});

vi.mock('@queries/channel/directory-core', async (importOriginal) => {
  const original = await importOriginal<typeof DirectoryCore>();
  const { countMapper } = await import('./harness-state');
  return {
    ...original,
    toDirectoryChannel: (
      ...args: Parameters<typeof original.toDirectoryChannel>
    ) =>
      countMapper('toDirectoryChannel', [args[0]], () =>
        original.toDirectoryChannel(...args)
      ),
    toChannelListItem: (
      ...args: Parameters<typeof original.toChannelListItem>
    ) =>
      countMapper('toChannelListItem', [args[0]], () =>
        original.toChannelListItem(...args)
      ),
  };
});

vi.mock('@queries/soup/transform-utils', async (importOriginal) => {
  const original = await importOriginal<typeof TransformUtils>();
  const { countMapper } = await import('./harness-state');
  return {
    ...original,
    mapSoupPageToEntityList: (
      ...args: Parameters<typeof original.mapSoupPageToEntityList>
    ) =>
      countMapper(
        'mapSoupPageToEntityList',
        args[0].items.map((item) =>
          item.tag === 'channel' ? item.data.channel : item.data
        ),
        () => original.mapSoupPageToEntityList(...args)
      ),
  };
});

const GUARDED_GLOBALS = ['fetch', 'WebSocket', 'EventSource'] as const;

/** Anything that would leave the process fails like a dropped connection
 * and is recorded, so a faithful run shows none. */
function guardNetwork(): () => void {
  const saved = GUARDED_GLOBALS.map(
    (name) => [name, globalThis[name]] as const
  );
  const record = (what: string) => {
    harnessState().escapes.push(what);
    return new TypeError('Failed to fetch');
  };
  Object.assign(globalThis, {
    fetch: async (input: RequestInfo | URL) => {
      throw record(
        `fetch ${String(input instanceof Request ? input.url : input)}`
      );
    },
    WebSocket: class {
      constructor(url: string | URL) {
        throw record(`WebSocket ${String(url)}`);
      }
    },
    EventSource: class {
      constructor(url: string | URL) {
        throw record(`EventSource ${String(url)}`);
      }
    },
  });
  return () => Object.assign(globalThis, Object.fromEntries(saved));
}

async function runScale(channels: number): Promise<RunScale.ChatScaleResult> {
  localStorage.clear();
  const fixture = createChatFixture(channels, FIXTURE_SEED);
  setHarnessState({ fixture, mappers: {}, flags: {}, escapes: [] });
  // Each load is its own module graph, as two page loads are.
  vi.resetModules();
  const earlier: typeof RunScale = await import('./run-scale');
  const seeded = await earlier.seedChatCache(fixture);
  vi.resetModules();
  const next: typeof RunScale = await import('./run-scale');
  return next.measureChat(fixture, seeded.opfs, seeded.seed, seeded.faults);
}

describe('Chat sidebar over the real cache', () => {
  const results: RunScale.ChatScaleResult[] = [];
  let restoreNetwork: (() => void) | undefined;

  beforeAll(() => {
    restoreNetwork = guardNetwork();
  });

  afterAll(() => {
    restoreNetwork?.();
  });

  it('counts the work of each scenario at N and 2N', async () => {
    const started = performance.now();
    for (const channels of SIZES) {
      const result = await runScale(channels);
      results.push(result);
      mkdirSync(dirname(RESULTS_PATH), { recursive: true });
      writeFileSync(
        RESULTS_PATH,
        `${JSON.stringify(
          {
            sizes: results,
            flags: harnessState().flags,
            runMs: Math.round(performance.now() - started),
          },
          null,
          2
        )}\n`
      );
    }
    for (const result of results) {
      expect(result.faults).toEqual({
        networkErrors: [],
        unsupportedReads: [],
        escapes: [],
        initializationErrors: [],
      });
    }
    const runs = results.map(gatedRun);
    if (process.env.UPDATE_CHAT_CACHE_BASELINE === '1') {
      writeBaseline(runs);
      return;
    }
    expect(
      gateFailures(runs, readBaseline()),
      'Chat cache harness gate (cache-harness/AGENTS.md). If the change is meant to move these counts, run `just test-cache-harness-update` in apps/web and commit baseline.json with the reason.'
    ).toEqual([]);
  }, 900_000);
});
