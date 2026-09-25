/** @vitest-environment jsdom */
import type { UnifiedNotification } from '@notifications/types';
import type { SoupApiItem } from '@service-storage/generated/schemas';
import {
  type InfiniteData,
  QueryClient,
  QueryObserver,
} from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let testQueryClient: QueryClient;
const getSoupItems = vi.hoisted(() => vi.fn());
vi.mock('../../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { getSoupItems },
}));
vi.mock('../graphql/active-queries', () => ({
  refreshActiveGraphqlSoupQueries: vi.fn(),
}));

import { updateSoupForNotification } from '../../notification/notification-soup';
import type { SoupAstItemsFlatPage } from '../items';
import { soupKeys } from '../keys';
import { getSoupNormalizer, initSoupNormalizer } from './normalizer';
import { clearNotifiedFloors, resolveNotifiedAt } from './notified-floor';
import {
  getSoupEntityById,
  invalidateSoupEntity,
  refetchSoupEntity,
  removeSoupEntitiesFromDoneFilteredQueries,
} from './operations';

type HomeData = InfiniteData<SoupAstItemsFlatPage, unknown>;
const OLD = '2026-09-22T12:00:00.000Z';
const NEW = '2026-09-24T12:00:00.000Z';
const homeKey = soupKeys.astItems({
  params: { expand: true, limit: 100, sort_method: 'notified_at' },
  body: { chanf: { l: { NotificationState: 'unseen' } } },
}).queryKey;

function channel(updatedAt: string, notifiedAt?: string): SoupApiItem {
  return {
    tag: 'channel',
    frecency_score: 1,
    is_favorited: false,
    ...(notifiedAt ? { notified_at: notifiedAt } : {}),
    data: {
      channel: {
        id: 'channel-1',
        name: 'Live notification test',
        channel_type: 'direct_message',
        owner_id: 'macro|sender@example.com',
        created_at: OLD,
        updated_at: updatedAt,
      },
      participants: [],
    },
  };
}

function page(items: SoupApiItem[]): HomeData {
  return {
    pages: [{ kind: 'flat', items, nextCursor: null }],
    pageParams: [null],
  };
}

function notification(createdAt = NEW): UnifiedNotification {
  return {
    id: `notification-${createdAt}`,
    entity_id: 'channel-1',
    entity_type: 'channel',
    created_at: createdAt,
    updated_at: createdAt,
    viewed_at: null,
    state: 'unseen',
    sent: true,
    notification_event_type: 'channel_message_send',
    notification_metadata: {
      tag: 'channel_message_send',
      content: {
        sender: 'macro|sender@example.com',
        messageId: 'message-1',
        messageContent: 'Live notification test',
        channelType: 'directMessage',
      },
    },
  };
}

let cleanup: Array<() => void>;
beforeEach(() => {
  getSoupItems.mockReset();
  testQueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  cleanup = [initSoupNormalizer(testQueryClient)];
});
afterEach(() => {
  for (const dispose of cleanup.reverse()) dispose();
  testQueryClient.clear();
  clearNotifiedFloors();
});

function mountHome(items = [channel(OLD, OLD)]) {
  let resolve!: (data: HomeData) => void;
  const response = new Promise<HomeData>((r) => {
    resolve = r;
  });
  let signal: AbortSignal | undefined;
  const queryFn = vi.fn(async (context: { signal: AbortSignal }) => {
    signal = context.signal;
    return await response;
  });
  const observer = new QueryObserver(testQueryClient, {
    queryKey: homeKey,
    queryFn,
    meta: { normalize: true },
    initialData: page(items),
  });
  cleanup.push(observer.subscribe(() => {}));
  // A success event indexes dependencies in the real Normy cache.
  testQueryClient.setQueryData(homeKey, page(items));
  return { observer, queryFn, resolve, signal: () => signal };
}

function homeItems() {
  return testQueryClient.getQueryData<HomeData>(homeKey)!.pages[0].items;
}

function cacheChannelOutsideHome() {
  // Another list keeps the channel normalized after Home removes it.
  testQueryClient.setQueryDefaults(['soup', 'items', 'other'], {
    meta: { normalize: true },
  });
  testQueryClient.setQueryData(
    ['soup', 'items', 'other'],
    page([channel(OLD)])
  );
}

describe('Home notification revalidation with real normalized query keys', () => {
  it('invalidates complete JSON-roundtripped keys with undefined optional slots', async () => {
    const home = mountHome();
    const [key] = getSoupNormalizer().getDependentQueriesByIds([
      'soup:channel-1',
    ]);
    expect(homeKey.slice(-2)).toEqual([undefined, undefined]);
    expect(key.slice(-2)).toEqual([null, null]);
    expect(testQueryClient.getQueryCache().findAll({ queryKey: key })).toEqual(
      []
    );

    invalidateSoupEntity('channel-1');
    expect(home.queryFn).toHaveBeenCalledOnce();
    home.resolve(page([channel(NEW, NEW)]));
    await vi.waitFor(() => expect(homeItems()[0].notified_at).toBe(NEW));
  });

  it('keeps a slow Home refetch alive when single-entity hydration finishes first', async () => {
    const home = mountHome();
    const refetch = testQueryClient.invalidateQueries({
      queryKey: homeKey,
      exact: true,
    });
    expect(home.queryFn).toHaveBeenCalledOnce();
    getSoupItems.mockResolvedValue(ok({ items: [channel(NEW)] }));

    await refetchSoupEntity('channel-1', 'channel');

    expect(home.signal()?.aborted).toBe(false);
    expect(home.observer.getCurrentResult().fetchStatus).toBe('fetching');
    // A single-entity response has no notification stamp; only the list does.
    expect(homeItems()[0].notified_at).toBe(OLD);
    home.resolve(page([channel(NEW, NEW)]));
    await refetch;
    expect(homeItems()[0].notified_at).toBe(NEW);
  });

  it('stamps Home immediately without inserting into the REST notification feed', () => {
    mountHome();
    updateSoupForNotification(notification());
    expect(homeItems()[0].notified_at).toBe(NEW);
    expect(
      testQueryClient.getQueryCache().findAll({ queryKey: ['notification'] })
    ).toEqual([]);

    updateSoupForNotification(notification(OLD));
    expect(homeItems()[0].notified_at).toBe(NEW);
  });

  it('keeps delivered recency when a replica-stale Home response arrives after the optimistic read', async () => {
    const home = mountHome();
    updateSoupForNotification(notification());
    expect(resolveNotifiedAt('channel-1', homeItems()[0].notified_at)).toBe(
      NEW
    );
    const refetch = testQueryClient.invalidateQueries({
      queryKey: homeKey,
      exact: true,
    });
    home.resolve(page([channel(NEW, OLD)]));
    await refetch;
    expect(resolveNotifiedAt('channel-1', homeItems()[0].notified_at)).toBe(
      NEW
    );
  });

  it('keeps a restored done-filtered row when its notification-triggered refetch omits it', async () => {
    const home = mountHome();
    cacheChannelOutsideHome();
    testQueryClient.setQueryData(homeKey, page([]));
    expect(getSoupEntityById('channel-1')).toBeDefined();

    updateSoupForNotification(notification());

    expect(homeItems()).toHaveLength(1);
    // Non-notified lists omit the stamp; Home's entity mapper applies its
    // delivered-notification floor when the cached row is restored.
    expect(resolveNotifiedAt('channel-1', homeItems()[0].notified_at)).toBe(
      NEW
    );

    // Notification callbacks revalidate after restoring the row. The replica
    // may still return the done-filtered page from before this notification.
    invalidateSoupEntity('channel-1');
    expect(home.queryFn).toHaveBeenCalledOnce();
    home.resolve(page([]));
    await vi.waitFor(() =>
      expect(home.observer.getCurrentResult().fetchStatus).toBe('idle')
    );
    expect(homeItems()).toHaveLength(1);
  });

  it('does not resurrect a restored row that the user marks done again', async () => {
    const home = mountHome([]);
    cacheChannelOutsideHome();
    updateSoupForNotification(notification());
    expect(homeItems()).toHaveLength(1);

    removeSoupEntitiesFromDoneFilteredQueries(new Set(['channel-1']));
    const refetch = testQueryClient.invalidateQueries({
      queryKey: homeKey,
      exact: true,
    });
    home.resolve(page([]));
    await refetch;
    expect(homeItems()).toEqual([]);
  });
});
