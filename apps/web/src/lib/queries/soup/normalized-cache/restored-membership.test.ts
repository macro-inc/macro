/** @vitest-environment jsdom */
import type { SoupApiItem } from '@service-storage/generated/schemas';
import { QueryClient, type QueryKey } from '@tanstack/solid-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { retainRestoredSoupItem } from './restored-membership';

const item: SoupApiItem = {
  tag: 'channel',
  frecency_score: 1,
  is_favorited: false,
  data: {
    channel: {
      id: 'channel-1',
      name: 'Restored conversation',
      channel_type: 'direct_message',
      owner_id: 'macro|sender@example.com',
      created_at: '2026-09-24T12:00:00Z',
      updated_at: '2026-09-24T12:00:00Z',
    },
    participants: [],
  },
};
const key = ['soup', 'astItems', {}, {}, undefined, undefined];
const data = (...pages: SoupApiItem[][]) => ({
  pages: pages.map((items) => ({
    kind: 'flat' as const,
    items,
    nextCursor: null,
  })),
  pageParams: pages.map((_, index) => index),
});
let client: QueryClient;
beforeEach(() => {
  client = new QueryClient();
});
afterEach(() => {
  client.clear();
  vi.useRealTimers();
});

function retain(queryKey: QueryKey = key) {
  const query = client.getQueryCache().build(client, {
    queryKey,
    initialData: data([item]),
  });
  retainRestoredSoupItem(client, queryKey, item);
  return query;
}

describe('retained notification-driven flat Soup membership', () => {
  it('survives repeated stale successes without replacing cursors or later pages', () => {
    const query = retain();
    const stale = data([], []);
    query.setData(stale);
    expect(query.state.data).toEqual({
      ...stale,
      pages: [{ ...stale.pages[0], items: [item] }, stale.pages[1]],
    });
    query.setData(data([item]));
    query.setData(stale);
    expect(query.state.data?.pages[0].items).toEqual([item]);
  });

  it('does not duplicate a restored item returned on a continuation page', () => {
    const query = retain();
    const response = data([], [item]);
    query.setData(response);
    expect(query.state.data).toEqual(response);
  });

  it('honors a later explicit local removal instead of restoring it again', () => {
    const query = retain();
    query.setData(data([]), { manual: true });
    query.setData(data([]));
    expect(query.state.data?.pages[0].items).toEqual([]);
  });

  it('retains the latest local entity snapshot', () => {
    const query = retain();
    const updated: SoupApiItem = { ...item, is_favorited: true };
    query.setData(data([updated]), { manual: true });
    query.setData(data([]));
    expect(query.state.data?.pages[0].items).toEqual([updated]);
  });

  it.each(['itemFilter', 'insertFilter'] as const)(
    'rechecks the current %s before replaying membership',
    (filter) => {
      const query = retain();
      query.setOptions({ ...query.options, meta: { [filter]: () => false } });
      query.setData(data([]));
      expect(query.state.data?.pages[0].items).toEqual([]);
    }
  );

  it('does not leak admission to a different query or query client', () => {
    retain();
    const otherFilter = client.getQueryCache().build(client, {
      queryKey: [...key, 'other-filter'],
      initialData: data([]),
    });
    otherFilter.setData(data([]));
    expect(otherFilter.state.data?.pages[0].items).toEqual([]);

    const otherClient = new QueryClient();
    try {
      const otherUser = otherClient.getQueryCache().build(otherClient, {
        queryKey: key,
        initialData: data([]),
      });
      otherUser.setData(data([]));
      expect(otherUser.state.data?.pages[0].items).toEqual([]);
    } finally {
      otherClient.clear();
    }
  });

  it('forgets restores when the query is removed', () => {
    retain();
    client.removeQueries({ queryKey: key, exact: true });
    const replacement = client.getQueryCache().build(client, {
      queryKey: key,
      initialData: data([]),
    });
    replacement.setData(data([]));
    expect(replacement.state.data?.pages[0].items).toEqual([]);
  });

  it('expires admission even if stale successes keep arriving', () => {
    vi.useFakeTimers();
    const query = retain();
    vi.advanceTimersByTime(4 * 60 * 1000);
    query.setData(data([]));
    expect(query.state.data?.pages[0].items).toEqual([item]);
    vi.advanceTimersByTime(60 * 1000);
    query.setData(data([]));
    expect(query.state.data?.pages[0].items).toEqual([]);
  });
});
