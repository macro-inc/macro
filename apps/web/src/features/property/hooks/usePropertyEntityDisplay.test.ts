import { useChannelName } from '@core/context/channels';
import { refreshActiveGraphqlPreviewQueries } from '@queries/preview/active-queries';
import type { PreviewItem } from '@queries/preview/types';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { ItemPreviewsQuery } from '@service-storage/graphql/generated/graphql';
import {
  type Client,
  cacheExchange,
  createClient,
  fetchExchange,
} from '@urql/core';
import { type Accessor, createMemo, createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  client: undefined as Client | undefined,
  channelNames: undefined as Accessor<Record<string, string>> | undefined,
  previewMounts: 0,
}));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true }),
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableGraphqlSoup: {},
  isFeatureEnabled: () => true,
  LOCAL_ONLY: false,
}));
vi.mock('@core/component/EntityIcon', () => ({ EntityIcon: () => null }));
vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => null }));
vi.mock('@core/constant/allBlocks', () => ({
  fileTypeToBlockName: (type: string) => type,
}));
vi.mock('@core/context/channels', () => ({
  useChannelName: vi.fn((id: string) =>
    createMemo(() => fixture.channelNames?.()[id])
  ),
}));
vi.mock('@core/user', () => ({
  tryMacroId: (id: string) => id,
  getDisplayName: (id: string) => id,
}));
vi.mock('@entity', () => ({ isTaskEntity: () => false }));
vi.mock('@service-storage/client', () => ({ DEFAULT_ITEM_TYPE: 'document' }));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => fixture.client,
  getGraphqlSoupCacheHost: () => undefined,
  mapGraphqlProperties: (properties: unknown[]) => properties,
}));
vi.mock('@app/lib/graphql-cache', () => ({
  selectRecords: () => ({}),
  readRecordsByKeys: vi.fn(),
}));
vi.mock('@tanstack/solid-query', () => ({
  useQuery: () => ({ isPending: false, isSuccess: false }),
}));
vi.mock('@queries/client', () => ({ queryClient: {} }));
vi.mock('@queries/preview/dataloader', () => ({ previewDataLoader: {} }));
vi.mock('@queries/preview/fetchers', () => ({
  defaultNameTransform: (item: PreviewItem) => ({ ...item }),
  fetchMessageContext: vi.fn(),
  fetchRestPreviewBatch: vi.fn(),
}));
vi.mock('@queries/preview', async () => {
  const preview = await import('@queries/preview/preview');
  const useItemPreview: typeof preview.useItemPreview = (item) => {
    // Bound hook recreation itself: a regressing memo can starve timers and
    // allocate forever before another query is executed or an assertion runs.
    if (++fixture.previewMounts > 10) {
      return [
        () => ({
          id: item().id,
          type: item().type ?? 'document',
          loading: true,
        }),
        { documentProperties: () => undefined },
      ];
    }
    return preview.useItemPreview(item);
  };
  return {
    ...preview,
    ...(await import('@queries/preview/types')),
    useItemPreview,
  };
});

import { usePropertyEntityDisplay } from './usePropertyEntityDisplay';

type PreviewRecord = ItemPreviewsQuery['user']['soup']['items'][number];

const disposals: Array<() => void> = [];
beforeEach(() => {
  fixture.previewMounts = 0;
  vi.useFakeTimers();
});
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
  vi.clearAllTimers();
  vi.restoreAllMocks();
  vi.mocked(useChannelName).mockClear();
  fixture.channelNames = undefined;
  vi.useRealTimers();
});

async function flushResults() {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}

function setupClient(records: PreviewRecord[]) {
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response(
        JSON.stringify({
          data: { user: { id: 'user', soup: { items: records } } },
        }),
        { headers: { 'Content-Type': 'application/json' } }
      )
  );
  const client = createClient({
    url: 'http://preview.test/graphql',
    exchanges: [cacheExchange, fetchExchange],
    fetch,
    preferGetMethod: false,
  });
  fixture.client = client;
  const executeQuery = vi.spyOn(client, 'executeQuery');
  return { fetch, executeQuery };
}

function documentRecord(id: string, name: string): PreviewRecord {
  return {
    __typename: 'GraphqlSoupDocument',
    id,
    displayName: name,
    documentName: name,
    fileType: 'md',
    subType: null,
    properties: [],
    viewerPermission: {
      __typename: 'GraphqlAccessLevelPermission',
      accessLevel: 'EDIT',
    },
  };
}

describe('property entity display with live GraphQL previews', () => {
  it('settles a cold preview and keeps its query mounted across name updates', async () => {
    const record = documentRecord('document-1', 'Roadmap');
    const { fetch, executeQuery } = setupClient([record]);
    const display = createRoot((dispose) => {
      disposals.push(dispose);
      return usePropertyEntityDisplay(
        () => record.id,
        () => 'DOCUMENT'
      );
    });
    expect(display.name()).toBe('Loading...');
    vi.advanceTimersByTime(30);
    await flushResults();
    expect(display.name()).toBe('Roadmap');
    expect(display.isLoading()).toBe(false);
    vi.advanceTimersByTime(90);
    await flushResults();
    expect(executeQuery).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);

    record.displayName = 'Renamed roadmap';
    await refreshActiveGraphqlPreviewQueries(record.id);
    expect(display.name()).toBe('Renamed roadmap');
    expect(display.blockOrFileType()).toBe('md');
    vi.advanceTimersByTime(90);
    await flushResults();
    expect(executeQuery).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('follows entity identity and type changes and releases disabled previews', async () => {
    const { executeQuery } = setupClient([
      documentRecord('document-1', 'First document'),
      documentRecord('document-2', 'Second document'),
      {
        __typename: 'GraphqlSoupProject',
        id: 'project-1',
        displayName: 'Launch project',
        projectName: 'Launch project',
      },
    ]);
    const [id, setId] = createSignal('document-1');
    const [type, setType] = createSignal<EntityType>('DOCUMENT');
    const display = createRoot((dispose) => {
      disposals.push(dispose);
      return usePropertyEntityDisplay(id, type);
    });
    vi.advanceTimersByTime(30);
    await flushResults();
    expect(display.name()).toBe('First document');

    setId('document-2');
    vi.advanceTimersByTime(30);
    await flushResults();
    expect(display.name()).toBe('Second document');

    setId('project-1');
    setType('PROJECT');
    vi.advanceTimersByTime(30);
    await flushResults();
    expect(display.name()).toBe('Launch project');
    expect(display.blockOrFileType()).toBe('project');

    setType('COMPANY');
    expect(display.name()).toBe('project-1');
    expect(display.isLoading()).toBe(false);
    await refreshActiveGraphqlPreviewQueries('project-1');
    expect(executeQuery).toHaveBeenCalledTimes(3);

    setId('document-1');
    setType('DOCUMENT');
    vi.advanceTimersByTime(30);
    await flushResults();
    expect(display.name()).toBe('First document');
    expect(display.blockOrFileType()).toBe('md');
    expect(executeQuery).toHaveBeenCalledTimes(4);
  });

  it('skips empty and unsupported entities and releases previews with their owner', async () => {
    const { executeQuery } = setupClient([
      documentRecord('document-1', 'Roadmap'),
    ]);
    const [id, setId] = createSignal('');
    const [type, setType] = createSignal<EntityType>('DOCUMENT');
    let disposeOwner = () => {};
    const display = createRoot((dispose) => {
      disposeOwner = dispose;
      disposals.push(dispose);
      return usePropertyEntityDisplay(id, type);
    });
    expect(display.isLoading()).toBe(false);
    vi.advanceTimersByTime(30);
    expect(executeQuery).not.toHaveBeenCalled();

    setType('USER');
    setId('document-1');
    for (const unsupported of [
      'USER',
      'COMPANY',
      'CALENDAR_EVENT',
      'CALL_RECORD',
    ] as const) {
      setType(unsupported);
      expect(display.isLoading()).toBe(false);
      vi.advanceTimersByTime(30);
      expect(executeQuery).not.toHaveBeenCalled();
    }

    setType('DOCUMENT');
    vi.advanceTimersByTime(30);
    await flushResults();
    expect(display.name()).toBe('Roadmap');
    expect(executeQuery).toHaveBeenCalledTimes(1);
    disposeOwner();
    await refreshActiveGraphqlPreviewQueries('document-1');
    expect(executeQuery).toHaveBeenCalledTimes(1);
  });

  it('updates channel names without recreating their subscription', () => {
    setupClient([]);
    const [names, setNames] = createSignal({
      'channel-1': 'First channel',
      'channel-2': 'Second channel',
    });
    fixture.channelNames = names;
    const [id, setId] = createSignal('channel-1');
    const display = createRoot((dispose) => {
      disposals.push(dispose);
      return usePropertyEntityDisplay(id, () => 'CHANNEL');
    });
    expect(display.name()).toBe('First channel');
    setNames({ 'channel-1': 'Renamed channel', 'channel-2': 'Second channel' });
    expect(display.name()).toBe('Renamed channel');
    expect(useChannelName).toHaveBeenCalledTimes(1);

    setId('channel-2');
    expect(display.name()).toBe('Second channel');
    expect(useChannelName).toHaveBeenCalledTimes(2);
  });
});
