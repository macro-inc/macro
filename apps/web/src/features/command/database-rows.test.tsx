import type {
  Bucket,
  QuickAccessListOptions,
} from '@core/context/quickAccess/types';
import type { CommandWithInfo } from '@core/hotkey/getCommands';
import type { UnifiedSearchResponse } from '@service-search/generated/models';
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDatabaseRowDiscovery } from './database-row-discovery';
import type { CategoryFilter } from './types';
import { useCommandItems } from './useCommandItems';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

const fixtures = vi.hoisted(() => ({
  flagEnabled: true,
  search: vi.fn(),
}));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({
    enabled: fixtures.flagEnabled,
    loading: false,
  }),
}));
vi.mock('@service-search/client', () => ({
  searchClient: { search: fixtures.search },
}));
vi.mock('@queries/team/members', () => ({
  useTeamMembers: () => ({
    users: () => [],
    isLoading: () => false,
    isError: () => false,
  }),
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'macro|viewer@macro.com',
}));
vi.mock('@core/context/quickAccess', () => ({
  exclude: () => [],
  useQuickAccess: () => ({
    useList: (_options: Bucket | QuickAccessListOptions) => ({
      items: () => [],
      isLoading: () => false,
      hasMore: () => false,
      isLoadingMore: () => false,
      error: () => undefined,
      loadMore: async () => {},
    }),
    usesRecordSelection: () => false,
    usesSearchProjection: () => true,
  }),
}));
vi.mock('@core/hotkey/getCommands', () => ({
  getActiveCommandsFromScope: (): CommandWithInfo[] => [],
}));
vi.mock('@core/hotkey/state', () => ({
  activeScope: () => 'root',
  hotkeyScopeTree: new Map(),
}));

const RESPONSE: UnifiedSearchResponse = {
  results: [
    {
      type: 'databaseRow',
      database_id: 'database',
      table_id: 'table',
      row_id: 'row',
      database_name: 'Hiring',
      table_name: 'Candidates',
      title: 'Ada Lovelace',
      snippet: '<macro_em>Ada</macro_em> wrote the first program',
      updated_at: '2026-11-01T00:00:00Z',
    },
  ],
  next_cursor: null,
};

beforeEach(() => {
  fixtures.flagEnabled = true;
  fixtures.search.mockResolvedValue(ok(RESPONSE));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderCommandItems(
  query: () => string,
  category: () => CategoryFilter
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let source!: ReturnType<typeof useCommandItems>;
  function Menu() {
    source = useCommandItems(query, category, {
      searchActive: () => true,
      databaseRowDiscovery: useDatabaseRowDiscovery,
    });
    return null;
  }
  render(() => (
    <QueryClientProvider client={client}>
      <Menu />
    </QueryClientProvider>
  ));
  return () => source.items();
}

it('searches only database rows for a typed query and lists them after search', async () => {
  const items = renderCommandItems(
    () => 'ada',
    () => 'all'
  );

  await waitFor(() =>
    expect(items().map((item) => item.id)).toEqual([
      'search:all:ada',
      'database-row:row',
    ])
  );
  expect(fixtures.search).toHaveBeenCalledOnce();
  const [args] = fixtures.search.mock.calls[0];
  expect(args.params).toEqual({ page_size: 6 });
  expect(args.request).toMatchObject({
    query: 'ada',
    match_type: 'partial',
    search_on: 'name_content',
    include_database_rows: true,
  });
  const filters = args.request.filters;
  for (const ids of [
    filters.document_filters.document_ids,
    filters.chat_filters.chat_ids,
    filters.email_filters.email_thread_ids,
    filters.channel_filters.channel_ids,
    filters.project_filters.project_ids,
    filters.call_filters.call_ids,
    filters.calendar_event_filters.calendar_event_ids,
    filters.crm_company_filters.company_ids,
  ]) {
    expect(ids).toEqual([NIL_UUID]);
  }
  expect(filters.agent_session_filters.include).toBeUndefined();
  const row = items()[1];
  expect(row.kind === 'database-row' && row.data).toEqual({
    databaseId: 'database',
    tableId: 'table',
    rowId: 'row',
    databaseName: 'Hiring',
    tableName: 'Candidates',
    title: 'Ada Lovelace',
    snippet: '<macro_em>Ada</macro_em> wrote the first program',
  });
});

it('sends no request with the flag off', async () => {
  fixtures.flagEnabled = false;
  const items = renderCommandItems(
    () => 'ada',
    () => 'all'
  );

  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(fixtures.search).not.toHaveBeenCalled();
  expect(items().map((item) => item.id)).toEqual([
    'search:all:ada',
    'ask-ai:ada',
  ]);
});

it('sends no request for an empty query or a category without rows', async () => {
  const [query, setQuery] = createSignal('');
  const [category, setCategory] = createSignal<CategoryFilter>('tasks');
  renderCommandItems(query, category);

  setQuery('ada');
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(fixtures.search).not.toHaveBeenCalled();

  setCategory('documents');
  await waitFor(() => expect(fixtures.search).toHaveBeenCalledOnce());
});

it('searches once for the term typing settles on', async () => {
  const [query, setQuery] = createSignal('');
  renderCommandItems(query, () => 'all');

  setQuery('a');
  setQuery('ad');
  setQuery('ada');
  await waitFor(() => expect(fixtures.search).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(
    fixtures.search.mock.calls.map((call) => call[0].request.query)
  ).toEqual(['ada']);
});
