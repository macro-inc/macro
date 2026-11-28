import { gql } from '@urql/core';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const registered = vi.hoisted(() => ({
  options: undefined as (() => { queries: readonly unknown[] }) | undefined,
}));

vi.mock('./register-notification-refresh', () => ({
  registerChannelNotificationRefresh: (
    options: () => { queries: readonly unknown[] }
  ) => {
    registered.options = options;
  },
}));
/** Each read the queue was asked for, settled by the test. */
const reads = vi.hoisted(
  () => [] as { page: unknown; land: (landed: boolean) => void }[]
);
vi.mock('./notification-refresh', () => ({
  channelNotificationRefresh: () => ({
    readAgain: (page: unknown) =>
      new Promise<boolean>((land) => {
        reads.push({ page, land });
      }),
  }),
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => ({}),
}));
vi.mock('../soup/items', () => ({ useSoupAstItemsQuery: vi.fn() }));
vi.mock('@entity', () => ({ isChannelEntity: () => true }));

import type { SoupAstItemsQuery } from '../soup/items';
import { registerChannelListNotificationRefresh } from './by-ids';

const PAGE = gql`query Page($cursor: String) { page(cursor: $cursor) { id } }`;
const page = (cursor: string | null) => ({
  document: PAGE,
  variables: { cursor },
});
const FIRST = page(null);
const SECOND = page('second');
const THIRD = page('third');
const FRESH_MS = 30_000;

/** A list whose kept pages and read gate the test moves. */
function list(
  kept: readonly ReturnType<typeof page>[] = [FIRST, SECOND, THIRD]
) {
  const [pages, setPages] = createSignal(kept);
  const [read, setRead] = createSignal(true);
  const dispose = createRoot((dispose) => {
    registerChannelListNotificationRefresh(
      {
        transport: 'graphql',
        isEnabled: true,
        isFetching: false,
        isPending: true,
        get revalidationQueries() {
          return pages();
        },
      } as unknown as SoupAstItemsQuery,
      undefined,
      undefined,
      { read, freshMs: FRESH_MS }
    );
    return dispose;
  });
  return { dispose, setPages, setRead };
}
const readPages = () => reads.map((entry) => entry.page);
const landAll = async (landed: boolean) => {
  for (const entry of reads.splice(0)) entry.land(landed);
  await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  reads.splice(0);
  vi.useRealTimers();
});

describe('registerChannelListNotificationRefresh', () => {
  it('registers only the first page while later pages are not read', () => {
    const { dispose, setRead } = list();
    try {
      expect(registered.options?.().queries).toEqual([FIRST, SECOND, THIRD]);
      setRead(false);
      expect(registered.options?.().queries).toEqual([FIRST]);
    } finally {
      dispose();
    }
  });

  it('reads each later page again once it has missed live updates for its fresh time, on return', async () => {
    const { dispose, setRead } = list();
    try {
      vi.advanceTimersByTime(60_000);
      expect(reads).toHaveLength(0);
      // A short return keeps the deadline set when reads first stopped.
      setRead(false);
      vi.advanceTimersByTime(10_000);
      setRead(true);
      vi.advanceTimersByTime(19_999);
      expect(reads).toHaveLength(0);
      vi.advanceTimersByTime(1);
      expect(readPages()).toEqual([SECOND, THIRD]);
      await landAll(true);
      // Pages read again are current until reads next stop.
      vi.advanceTimersByTime(60_000);
      expect(reads).toHaveLength(0);
      setRead(false);
      vi.advanceTimersByTime(60_000);
      expect(reads).toHaveLength(0);
      setRead(true);
      vi.advanceTimersByTime(0);
      expect(readPages()).toEqual([SECOND, THIRD]);
    } finally {
      dispose();
    }
  });

  it('keeps the deadline of a page the queue dropped and reads it at once on return', async () => {
    const { dispose, setRead } = list();
    try {
      setRead(false);
      vi.advanceTimersByTime(40_000);
      setRead(true);
      vi.advanceTimersByTime(0);
      expect(readPages()).toEqual([SECOND, THIRD]);
      // The second page lands; the view leaves before the third does, and
      // the queue drops it.
      reads.shift()?.land(true);
      setRead(false);
      await landAll(false);
      vi.advanceTimersByTime(2_000);
      setRead(true);
      vi.advanceTimersByTime(0);
      expect(readPages()).toEqual([THIRD]);
    } finally {
      dispose();
    }
  });

  it('counts a page that lands while reads are stopped from when it landed', () => {
    const { dispose, setPages, setRead } = list([FIRST]);
    try {
      // A continuation in flight when reads stop lands afterwards.
      setRead(false);
      vi.advanceTimersByTime(5_000);
      setPages([FIRST, SECOND]);
      vi.advanceTimersByTime(1_000);
      setRead(true);
      vi.advanceTimersByTime(28_999);
      expect(reads).toHaveLength(0);
      vi.advanceTimersByTime(1);
      expect(readPages()).toEqual([SECOND]);
    } finally {
      dispose();
    }
  });

  it('forgets later pages the list dropped', () => {
    const { dispose, setPages, setRead } = list();
    try {
      setRead(false);
      vi.advanceTimersByTime(10_000);
      setPages([FIRST]);
      vi.advanceTimersByTime(60_000);
      // Pages read again while reads hold get every live update.
      setRead(true);
      setPages([FIRST, SECOND, THIRD]);
      vi.advanceTimersByTime(60_000);
      expect(reads).toHaveLength(0);
    } finally {
      dispose();
    }
  });
});
