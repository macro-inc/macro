import { loadDatabase } from '@app/features/block-database/queries/load-database';
import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import { okAsync, ResultAsync } from 'neverthrow';
import { beforeEach, expect, it, vi } from 'vitest';

const getDatabase = vi.hoisted(() => vi.fn());
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { databases: { get: getDatabase } },
}));
vi.mock('@core/constant/allBlocks', () => ({ itemToSafeName: () => '' }));
vi.mock('@service-cognition/client', () => ({ cognitionApiServiceClient: {} }));
vi.mock('@service-email/client', () => ({ emailClient: {} }));
vi.mock('@service-storage/messages', () => ({ entityMessagesClient: {} }));
vi.mock('../../email/thread', () => ({ threadQueryOptions: vi.fn() }));
vi.mock('../../agent-session/mention-fetchers', () => ({
  fetchAgentSessionMentionPreviews: vi.fn(),
}));
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
  };
});

import { queryClient } from '@queries/client';
import { fetchRestPreviewBatch } from '../fetchers';

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

beforeEach(() => {
  queryClient.clear();
  getDatabase.mockReset();
  getDatabase.mockImplementation(() => okAsync(detail));
});

it('previews an opened database from the read that opened it', async () => {
  (await loadDatabase('db'))._unsafeUnwrap();
  const previews = await fetchRestPreviewBatch([
    { type: 'database', id: 'db' },
  ]);
  expect(previews.get('db')).toMatchObject({
    access: 'access',
    name: 'Planning',
  });
  expect(getDatabase).toHaveBeenCalledOnce();
});

it('opens a database on the preview read still in flight', async () => {
  let finish!: (value: DatabaseDetail) => void;
  getDatabase.mockReturnValueOnce(
    ResultAsync.fromSafePromise(
      new Promise<DatabaseDetail>((resolve) => {
        finish = resolve;
      })
    )
  );
  const previewed = fetchRestPreviewBatch([{ type: 'database', id: 'db' }]);
  await Promise.resolve();
  const opened = loadDatabase('db');
  finish(detail);
  await previewed;
  (await opened)._unsafeUnwrap();
  expect(getDatabase).toHaveBeenCalledOnce();
});
