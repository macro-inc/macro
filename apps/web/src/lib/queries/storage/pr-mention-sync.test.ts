import type { ForeignEntity } from '@service-storage/generated/schemas';
import { QueryObserver } from '@tanstack/query-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const refreshLists = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@queries/agent-session/list-sync', () => ({
  refreshAgentSessionLists: refreshLists,
}));

vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/query-core');
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
  };
});

import { queryClient } from '@queries/client';
import { pullRequestMentionKeys } from './keys';
import {
  handlePullRequestUpdated,
  invalidatePullRequestMentions,
} from './pr-mention-sync';

const entity: ForeignEntity = {
  id: '019f0000-0000-7000-8000-000000000001',
  foreignEntityId: 'owner/repo/pull/12',
  foreignEntitySource: 'github_pull_request',
  storedForId: 'macro|test@example.com',
  storedForAuthEntity: 'user',
  metadata: { status: 'open' },
  createdAt: '2026-09-14T00:00:00Z',
  updatedAt: '2026-09-14T00:00:00Z',
};
const byKey = pullRequestMentionKeys.byGithubKey(
  entity.foreignEntityId
).queryKey;
const byId = pullRequestMentionKeys.foreignEntity(entity.id).queryKey;

beforeEach(() => {
  queryClient.clear();
  vi.clearAllMocks();
});

describe('PR gateway updates', () => {
  it('resolves a pending mapping and updates the by-id cache', async () => {
    queryClient.setQueryData(byKey, null);
    await handlePullRequestUpdated(entity);
    expect(queryClient.getQueryData(byKey)).toEqual(entity);
    expect(queryClient.getQueryData(byId)).toEqual(entity);
    expect(refreshLists).not.toHaveBeenCalled();
  });

  it('cancels an older lookup so its null response cannot erase a push', async () => {
    let finish!: (value: null) => void;
    const request = queryClient.fetchQuery({
      queryKey: byKey,
      queryFn: () =>
        new Promise<null>((resolve) => {
          finish = resolve;
        }),
    });
    // Cancellation is the expected outcome of the obsolete request.
    const cancelled = expect(request).rejects.toThrow();
    await handlePullRequestUpdated(entity);
    finish(null);
    await cancelled;
    expect(queryClient.getQueryData(byKey)).toEqual(entity);
  });

  it('keeps a newer status when an older event arrives afterward', async () => {
    const merged = {
      ...entity,
      metadata: { status: 'merged' },
      updatedAt: '2026-09-14T00:01:00Z',
    };
    await handlePullRequestUpdated(merged);
    await handlePullRequestUpdated(entity);
    expect(queryClient.getQueryData(byKey)).toEqual(merged);
    expect(queryClient.getQueryData(byId)).toEqual(merged);
  });

  it('ignores malformed events and other foreign entity sources', async () => {
    await handlePullRequestUpdated({ id: entity.id });
    await handlePullRequestUpdated({ ...entity, foreignEntitySource: 'other' });
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(refreshLists).not.toHaveBeenCalled();
  });

  it('refetches mounted queries after connection recovery', async () => {
    queryClient.setQueryData(byKey, null);
    const fetch = vi.fn().mockResolvedValue(entity);
    const observer = new QueryObserver(queryClient, {
      queryKey: byKey,
      queryFn: fetch,
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {});
    invalidatePullRequestMentions();
    await vi.waitFor(() =>
      expect(queryClient.getQueryData(byKey)).toEqual(entity)
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
