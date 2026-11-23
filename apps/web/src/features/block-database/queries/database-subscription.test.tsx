import { useDatabaseDetailQuery } from '@queries/storage/databases';
import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import { cleanup, render } from '@solidjs/testing-library';
import { okAsync } from 'neverthrow';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDatabaseSubscription } from './database-subscription';
import { loadDatabase } from './load-database';

type Refresh = (
  entity: { entity_type: string; entity_id: string },
  reason: 'subscribed' | 'reconnected' | 'refocused'
) => void;
const mock = vi.hoisted(() => ({
  get: vi.fn(),
  refresh: undefined as Refresh | undefined,
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { databases: { get: mock.get } },
}));
vi.mock('@service-connection/client', () => ({
  useEntitySubscription: (
    entity: () => { entity_type: string; entity_id: string },
    refresh: Refresh
  ) => {
    mock.refresh = refresh;
    refresh(entity(), 'subscribed');
  },
}));
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
  };
});

const detail: DatabaseDetail = {
  database: {
    id: 'db',
    name: 'Planning',
    owner_id: 'owner',
    created_at: '',
    trashed_at: null,
    project_id: null,
  },
  grant: 'owner',
  tables: [],
};

beforeEach(async () => {
  const { queryClient } = await import('@queries/client');
  queryClient.clear();
  mock.get.mockReset();
  mock.get.mockImplementation(() => okAsync(detail));
});
afterEach(cleanup);

async function settled() {
  const { queryClient } = await import('@queries/client');
  await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));
}

async function mountGrid(schema: 'opened' | 'cached') {
  const { queryClient } = await import('@queries/client');
  const { QueryClientProvider } = await import('@tanstack/solid-query');
  const refreshRows = vi.fn();
  function Grid() {
    const query = useDatabaseDetailQuery(() => 'db');
    useDatabaseSubscription('db', refreshRows, schema);
    return <span>{query.isSuccess ? query.data.database.name : ''}</span>;
  }
  render(() => (
    <QueryClientProvider client={queryClient}>
      <Grid />
    </QueryClientProvider>
  ));
  await settled();
  return refreshRows;
}

it('reads a database once when it opens, and again after a reconnect', async () => {
  (await loadDatabase('db'))._unsafeUnwrap();
  const refreshRows = await mountGrid('opened');
  expect(mock.get).toHaveBeenCalledOnce();
  expect(refreshRows).toHaveBeenCalledOnce();
  mock.refresh?.({ entity_type: 'database', entity_id: 'db' }, 'reconnected');
  await settled();
  expect(mock.get).toHaveBeenCalledTimes(2);
  expect(refreshRows).toHaveBeenCalledTimes(2);
});

it('reads the schema again on every open, though a recent read is cached', async () => {
  (await loadDatabase('db'))._unsafeUnwrap();
  (await loadDatabase('db'))._unsafeUnwrap();
  expect(mock.get).toHaveBeenCalledTimes(2);
});

it('catches up a cached schema when a grid starts tracking its database', async () => {
  const { queryClient } = await import('@queries/client');
  const { databasesKeys } = await import('@queries/storage/keys');
  queryClient.setQueryData(databasesKeys.detail('db').queryKey, detail);
  await mountGrid('cached');
  expect(mock.get).toHaveBeenCalledOnce();
});
