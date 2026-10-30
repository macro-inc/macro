import { errAsync, okAsync } from 'neverthrow';
import { expect, it, vi } from 'vitest';

const getRoutine = vi.hoisted(() => vi.fn());
vi.mock('@service-scheduled-action/client', () => ({
  scheduledActionClient: { getRoutine },
}));
vi.mock('@service-storage/client', () => ({ storageServiceClient: {} }));
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

it('previews a routine the viewer can read, a deleted one as gone, and a hidden one as no access', async () => {
  getRoutine.mockReturnValueOnce(
    okAsync({
      id: 'standup',
      name: 'Daily standup',
      owner: 'macro|wolf@macro.com',
      updated_at: '2026-10-01T09:00:00Z',
    })
  );
  const readable = await fetchRestPreviewBatch([
    { type: 'routine', id: 'standup' },
  ]);
  expect(getRoutine).toHaveBeenCalledWith('standup');
  expect(readable.get('standup')).toEqual({
    id: 'standup',
    type: 'routine',
    access: 'access',
    loading: false,
    rawName: 'Daily standup',
    name: 'Daily standup',
    owner: 'macro|wolf@macro.com',
    updatedAt: '2026-10-01T09:00:00Z',
  });

  getRoutine.mockReturnValueOnce(
    errAsync([{ code: 'NOT_FOUND', message: 'No such routine' }])
  );
  const gone = await fetchRestPreviewBatch([
    { type: 'routine', id: 'deleted' },
  ]);
  expect(gone.get('deleted')).toEqual({
    id: 'deleted',
    type: 'routine',
    access: 'does_not_exist',
    loading: false,
  });

  getRoutine.mockReturnValueOnce(
    errAsync([{ code: 'FORBIDDEN', message: 'Not your routine' }])
  );
  const hidden = await fetchRestPreviewBatch([
    { type: 'routine', id: 'private' },
  ]);
  expect(hidden.get('private')).toEqual({
    id: 'private',
    type: 'routine',
    access: 'no_access',
    loading: false,
  });
});
