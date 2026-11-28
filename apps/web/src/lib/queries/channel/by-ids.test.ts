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
  const dispose = createRoot((dispose) => {
    registerChannelListNotificationRefresh(
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
    );
    return dispose;
  });
  try {
    expect(registered.options?.().queries).toEqual(pages);
    setLaterPages(false);
    expect(registered.options?.().queries).toEqual([{ page: 'first' }]);
  } finally {
    dispose();
  }
});
