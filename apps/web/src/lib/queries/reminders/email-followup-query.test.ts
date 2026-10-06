import type { EmailFollowup } from '@service-storage/generated/schemas/emailFollowup';
import { QueryClient, QueryObserver } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { afterEach, expect, it, vi } from 'vitest';
import { queryClient } from '../client';
import { emailFollowupQueryOptions } from './email-followup';
import { reminderKeys } from './keys';

const read = vi.hoisted(() => vi.fn());
vi.mock('../client', () => ({ queryClient: new QueryClient() }));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { reminders: { getEmailFollowup: read } },
}));
vi.mock('../soup/cache', () => ({ refetchSoupEntity: vi.fn() }));
vi.mock('../soup/graphql/active-queries', () => ({
  refreshActiveGraphqlSoupQueries: vi.fn(),
}));
vi.mock('../email/graphql/thread', () => ({
  fetchGraphqlEmailThread: vi.fn(),
}));

const followup: EmailFollowup = {
  condition: 'regardless',
  linkId: 'inbox',
  remindAt: '2027-12-01T12:00:00Z',
  reminderId: 'reminder',
  revision: 'original',
  state: 'pending',
  threadId: 'thread',
};
const collectionKey = reminderKeys.emailCollection('owner', {}).queryKey;
const seedCollection = (updatedAt: number) =>
  queryClient.setQueryData(
    collectionKey,
    {
      pages: [{ items: [{ threadId: 'thread', followup }], nextCursor: null }],
      pageParams: [undefined],
    },
    { updatedAt }
  );

afterEach(() => {
  queryClient.clear();
  vi.resetAllMocks();
});

it('opens a listed reminder from the collection cache without another network wait', () => {
  seedCollection(Date.now());
  const observer = new QueryObserver(
    queryClient,
    emailFollowupQueryOptions('thread')
  );
  const stop = observer.subscribe(() => {});
  try {
    expect(observer.getCurrentResult().data).toEqual(followup);
    expect(observer.getCurrentResult().isSuccess).toBe(true);
    expect(read).not.toHaveBeenCalled();
  } finally {
    stop();
  }
});

it('preserves the age of cached collection data and refreshes stale reminders', async () => {
  const updatedAt = Date.now() - 60_000;
  seedCollection(updatedAt);
  read.mockResolvedValue(ok({ ...followup, revision: 'newer' }));
  const observer = new QueryObserver(
    queryClient,
    emailFollowupQueryOptions('thread')
  );
  expect(observer.getCurrentResult().dataUpdatedAt).toBe(updatedAt);
  const stop = observer.subscribe(() => {});
  try {
    expect(observer.getCurrentResult().data).toEqual(followup);
    await vi.waitFor(() =>
      expect(observer.getCurrentResult().data?.revision).toBe('newer')
    );
    expect(read).toHaveBeenCalledWith('thread');
  } finally {
    stop();
  }
});

it('does not infer that an email missing from a filtered page has no reminder', () => {
  seedCollection(Date.now());
  expect(
    emailFollowupQueryOptions('another-thread').initialData
  ).toBeUndefined();
});

it('does not revive an invalidated collection entry or replace a newer detail entry', async () => {
  seedCollection(Date.now());
  await queryClient.invalidateQueries({ queryKey: collectionKey });
  expect(emailFollowupQueryOptions('thread').initialData).toBeUndefined();
  seedCollection(Date.now());
  queryClient.setQueryData(reminderKeys.email('thread').queryKey, {
    ...followup,
    state: 'removed',
  });
  const observer = new QueryObserver(
    queryClient,
    emailFollowupQueryOptions('thread')
  );
  expect(observer.getCurrentResult().data?.state).toBe('removed');
});
