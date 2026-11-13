import type {
  ForeignEntity,
  SoupApiItem,
} from '@service-storage/generated/schemas';
import { type InfiniteData, QueryObserver } from '@tanstack/query-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refreshLists = vi.hoisted(() => vi.fn(async () => {}));
const account = vi.hoisted(() => ({ userId: 'viewer', session: 1 }));
vi.mock('@queries/auth/account-scope', () => ({
  currentQueryAccount: () => ({ ...account }),
  isCurrentQueryAccount: (captured: typeof account) =>
    captured.userId === account.userId && captured.session === account.session,
}));
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
import type { SoupAstItemsFlatPage } from '@queries/soup/items';
import { soupKeys } from '@queries/soup/keys';
import { initSoupNormalizer } from '@queries/soup/normalized-cache/normalizer';
import {
  prForeignEntityKeys,
  pullRequestMentionKeys,
  reviewsMergeabilityKeys,
} from './keys';
import {
  handlePullRequestUpdated,
  invalidatePullRequestMentions,
} from './pr-mention-sync';

const entity = {
  id: '019f0000-0000-7000-8000-000000000001',
  foreignEntityId: 'owner/repo/pull/12',
  foreignEntitySource: 'github_pull_request',
  storedForId: 'macro|test@example.com',
  storedForAuthEntity: 'user',
  metadata: { status: 'open' },
  createdAt: '2026-09-14T00:00:00Z',
  updatedAt: '2026-09-14T00:00:00Z',
} satisfies ForeignEntity;
const byKey = pullRequestMentionKeys.byGithubKey(
  entity.foreignEntityId
).queryKey;
const byId = pullRequestMentionKeys.foreignEntity(entity.id).queryKey;

let stopNormalizer: () => void;
afterEach(() => stopNormalizer());
beforeEach(() => {
  queryClient.clear();
  vi.clearAllMocks();
  account.session = 1;
  stopNormalizer = initSoupNormalizer(queryClient);
});

it.each(['check_run', 'closed'] as const)(
  'applies a %s push to the cached Reviews list without refetching',
  async (event) => {
    const key = soupKeys.astItems({
      params: { expand: true, limit: 100 },
      body: {},
    }).queryKey;
    const item: SoupApiItem = {
      tag: 'foreignEntity',
      data: entity,
      frecency_score: 3,
      is_favorited: false,
    };
    const page: InfiniteData<SoupAstItemsFlatPage, unknown> = {
      pages: [{ kind: 'flat', items: [item], nextCursor: null }],
      pageParams: [null],
    };
    const fetch = vi.fn().mockResolvedValue(page);
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn: fetch,
      staleTime: Infinity,
      meta: { normalize: true },
      initialData: page,
    });
    const unsubscribe = observer.subscribe(() => {});
    queryClient.setQueryData(key, page);
    const checks = [
      { id: 1, name: 'ci', status: 'completed', conclusion: 'failure' },
    ];
    await handlePullRequestUpdated({
      ...entity,
      updatedAt: '2026-09-14T00:01:00Z',
      metadata: { status: event === 'closed' ? 'closed' : 'open', checks },
    });
    const cached = queryClient.getQueryData<typeof page>(key)!;
    expect(cached.pages[0].items[0]).toMatchObject({
      data: {
        metadata: { status: event === 'closed' ? 'closed' : 'open', checks },
      },
    });
    expect(cached.pages[0].items[0].frecency_score).toBe(3);
    expect(fetch).not.toHaveBeenCalled();
    unsubscribe();
  }
);
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

  it('revalidates only the matching PR details and conflict batches, not lists', async () => {
    const detailKey =
      prForeignEntityKeys['foreign-entity']('personal-copy').queryKey;
    const unrelatedDetailKey =
      prForeignEntityKeys['foreign-entity']('unrelated').queryKey;
    const conflictsKey = reviewsMergeabilityKeys.mergeability([
      'owner/repo#12',
    ]).queryKey;
    const unrelatedConflictsKey = reviewsMergeabilityKeys.mergeability([
      'owner/repo#99',
    ]).queryKey;
    const listKey = ['reviews-list'];
    queryClient.setQueryData(detailKey, {
      pullRequest: { githubKey: entity.foreignEntityId },
    });
    queryClient.setQueryData(unrelatedDetailKey, {
      pullRequest: { githubKey: 'owner/repo/pull/99' },
    });
    for (const key of [conflictsKey, unrelatedConflictsKey, listKey]) {
      queryClient.setQueryData(key, []);
    }

    await handlePullRequestUpdated({
      ...entity,
      metadata: { status: 'closed' },
    });

    expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(conflictsKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(unrelatedDetailKey)?.isInvalidated).toBe(
      false
    );
    expect(
      queryClient.getQueryState(unrelatedConflictsKey)?.isInvalidated
    ).toBe(false);
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(false);
  });

  it('does not publish a pending event into a replacement account', async () => {
    const originalCancel = queryClient.cancelQueries.bind(queryClient);
    const cancel = vi
      .spyOn(queryClient, 'cancelQueries')
      .mockImplementation(async (...args) => {
        await originalCancel(...args);
        account.session += 1;
      });
    await handlePullRequestUpdated(entity);
    expect(queryClient.getQueryData(byKey)).toBeUndefined();
    expect(queryClient.getQueryData(byId)).toBeUndefined();
    cancel.mockRestore();
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
