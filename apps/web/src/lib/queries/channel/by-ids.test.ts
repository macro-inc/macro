import { createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';

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
const invalidateQuery = vi.hoisted(() => vi.fn(() => true));
vi.mock('./notification-refresh', () => ({
  channelNotificationRefresh: () => ({ invalidateQuery }),
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => ({}),
}));
vi.mock('../soup/items', () => ({ useSoupAstItemsQuery: vi.fn() }));
vi.mock('@entity', () => ({ isChannelEntity: () => true }));

import type { SoupAstItemsQuery } from '../soup/items';
import { registerChannelListNotificationRefresh } from './by-ids';

it('registers only the first page while later pages are not read again', () => {
  const pages = [{ page: 'first' }, { page: 'second' }, { page: 'third' }];
  const [laterPages, setLaterPages] = createSignal(true);
  const { dispose, readPagesAgain } = createRoot((dispose) => ({
    dispose,
    readPagesAgain: registerChannelListNotificationRefresh(
      {
        transport: 'graphql',
        isEnabled: true,
        isFetching: false,
        isPending: true,
        revalidationQueries: pages,
      } as unknown as SoupAstItemsQuery,
      undefined,
      undefined,
      laterPages
    ),
  }));
  try {
    expect(registered.options?.().queries).toEqual(pages);
    readPagesAgain();
    expect(invalidateQuery.mock.calls).toEqual(pages.map((page) => [page]));
    setLaterPages(false);
    expect(registered.options?.().queries).toEqual([{ page: 'first' }]);
    invalidateQuery.mockClear();
    readPagesAgain();
    expect(invalidateQuery.mock.calls).toEqual([[{ page: 'first' }]]);
  } finally {
    dispose();
  }
});
