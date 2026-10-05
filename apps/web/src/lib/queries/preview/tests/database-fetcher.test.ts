import { errAsync, okAsync } from 'neverthrow';
import { expect, it, vi } from 'vitest';

const getDatabase = vi.hoisted(() => vi.fn());
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { databases: { get: getDatabase } },
}));
vi.mock('@core/constant/allBlocks', () => ({ itemToSafeName: () => '' }));
vi.mock('@service-cognition/client', () => ({ cognitionApiServiceClient: {} }));
vi.mock('@service-email/client', () => ({ emailClient: {} }));
vi.mock('@service-storage/messages', () => ({ entityMessagesClient: {} }));
vi.mock('../../email/thread', () => ({ threadQueryOptions: vi.fn() }));
vi.mock('../../client', () => ({ queryClient: {} }));
vi.mock('../../agent-session/mention-fetchers', () => ({
  fetchAgentSessionMentionPreviews: vi.fn(),
}));

import { fetchRestPreviewBatch } from '../fetchers';

it('previews a shared database its owner can open, and a deleted one as gone', async () => {
  getDatabase.mockReturnValueOnce(
    okAsync({
      database: {
        id: 'wedding',
        name: 'Wedding',
        owner_id: 'macro|wolf@macro.com',
        created_at: '2026-09-01T00:00:00Z',
        trashed_at: null,
      },
      grant: 'owner',
      tables: [],
    })
  );
  const owned = await fetchRestPreviewBatch([
    { type: 'database', id: 'wedding' },
  ]);
  expect(getDatabase).toHaveBeenCalledWith({ id: 'wedding' });
  expect(owned.get('wedding')).toEqual({
    id: 'wedding',
    type: 'database',
    access: 'access',
    loading: false,
    rawName: 'Wedding',
    name: 'Wedding',
    owner: 'macro|wolf@macro.com',
  });

  getDatabase.mockReturnValueOnce(
    errAsync([{ code: 'NOT_FOUND', message: 'No such database' }])
  );
  const gone = await fetchRestPreviewBatch([
    { type: 'database', id: 'deleted' },
  ]);
  expect(gone.get('deleted')).toEqual({
    id: 'deleted',
    type: 'database',
    access: 'does_not_exist',
    loading: false,
  });

  getDatabase.mockReturnValueOnce(
    errAsync([{ code: 'FORBIDDEN', message: 'Not shared with you' }])
  );
  const denied = await fetchRestPreviewBatch([
    { type: 'database', id: 'private' },
  ]);
  expect(denied.get('private')).toEqual({
    id: 'private',
    type: 'database',
    access: 'no_access',
    loading: false,
  });
});
