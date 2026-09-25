import { cleanup, render, screen } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SoupViewContextProvider } from './soup-view-context';

// The provider builds its query options during setup. solid-query evaluates an
// options accessor synchronously inside the hook call (createMemo), so anything
// the accessor reads must already be declared. These mocks keep that eager
// evaluation while stubbing the network-backed queries.
const mocks = vi.hoisted(() => {
  // jsdom's WebSocket delegates to `ws`, which refuses to run in a browser
  // environment; app-shell singletons open one at import time.
  class FakeWebSocket {
    readyState = 1;
    close() {}
    send() {}
    addEventListener() {}
    removeEventListener() {}
  }
  vi.stubGlobal('WebSocket', FakeWebSocket);
  return {
    itemsOptionsEvaluated: vi.fn(),
    groupedOptionsEvaluated: vi.fn(),
    searchOptionsEvaluated: vi.fn(),
  };
});

vi.mock('@queries/soup/items', () => ({
  useSoupAstItemsQuery: (
    args: () => unknown,
    options?: () => { meta?: unknown }
  ) => {
    args();
    mocks.itemsOptionsEvaluated(options?.());
    return {
      transport: 'rest',
      data: undefined,
      error: null,
      isLoading: false,
      isFetching: false,
      isFetchingNextPage: false,
      isPlaceholderData: false,
      isEnabled: () => true,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      refresh: vi.fn(),
      resetToInitialPage: vi.fn(),
    };
  },
}));

vi.mock('@queries/soup/grouped/create-grouped-soup-queries', () => ({
  createGroupedSoupQueries: (args: {
    groupByField: () => unknown;
    initialPage: () => unknown;
    soupParams: () => unknown;
    soupBody: () => unknown;
    transport: () => unknown;
    queryOptions: () => { meta?: unknown };
  }) => {
    args.groupByField();
    args.initialPage();
    args.soupParams();
    args.soupBody();
    args.transport();
    mocks.groupedOptionsEvaluated(args.queryOptions());
    return { map: () => new Map(), resetToInitialPage: vi.fn() };
  },
}));

vi.mock('@queries/soup/search', () => ({
  validateSearchServiceText: () => false,
  useSearchSoupQuery: (args: () => unknown, options?: () => unknown) => {
    args();
    mocks.searchOptionsEvaluated(options?.());
    return {
      data: undefined,
      error: null,
      isLoading: false,
      isFetching: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
    };
  },
}));
vi.mock('@app/features/soup/search', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSearchContext: () => ({ entityPool: () => [] }),
  useOptionalSearchContext: () => ({ entityPool: () => [] }),
}));
vi.mock('@queries/properties/tags', () => ({
  useTagsQuery: () => ({ data: [], isSuccess: true }),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { send() {}, addEventListener() {}, removeEventListener() {} },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect() {},
  createConnectionWebsocketEffect() {},
  parseWebsocketPayload: () => undefined,
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    handle: {
      id: 'panel-1',
      isActive: () => true,
      content: () => ({ type: 'component', id: 'inbox' }),
      currentEntryState: () => undefined,
      registerEntryStateCaptor: () => () => {},
    },
  }),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'user-1' }));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => ({}),
}));
vi.mock('@companies/crm/deal-stages', () => ({
  useDealStages: () => ({
    stages: () => [],
    stageDefinitionId: () => undefined,
    resolveStage: () => undefined,
    stageLabel: () => undefined,
  }),
}));
vi.mock('@queries/team/teams', () => ({ useIsTeamAdmin: () => () => false }));
vi.mock('@app/features/next-soup/use-soup-filter-persistence', () => ({
  useSoupFilterPersistence: () => [vi.fn()],
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: false }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SoupViewContextProvider setup', () => {
  it('mounts with query options evaluated synchronously during setup', () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(() => (
      <QueryClientProvider client={client}>
        <SoupViewContextProvider>
          <div data-testid="child">ready</div>
        </SoupViewContextProvider>
      </QueryClientProvider>
    ));

    expect(screen.getByTestId('child').textContent).toBe('ready');
    expect(mocks.itemsOptionsEvaluated).toHaveBeenCalledTimes(1);
    expect(mocks.groupedOptionsEvaluated).toHaveBeenCalledTimes(1);
    const meta = mocks.itemsOptionsEvaluated.mock.calls[0]?.[0]?.meta as {
      itemFilter?: unknown;
      insertFilter?: unknown;
    };
    expect(typeof meta.itemFilter).toBe('function');
    expect(typeof meta.insertFilter).toBe('function');
  });
});
