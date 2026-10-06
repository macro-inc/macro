import type { CrmContactEntity } from '@entity';
import { batch, createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createContactDiscovery } from './contact-discovery';

const contact = (
  id: string,
  overrides: Partial<CrmContactEntity> = {}
): CrmContactEntity => ({
  type: 'crm_contact',
  id,
  ownerId: 'team',
  companyId: 'company',
  name: id,
  email: `${id}@example.com`,
  hidden: false,
  lastInteraction: '2026-01-01T00:00:00Z',
  ...overrides,
});

let dispose: (() => void) | undefined;
afterEach(() => dispose?.());

function setup() {
  return createRoot((cleanup) => {
    dispose = cleanup;
    const [query, setQuery] = createSignal('');
    const [serverQuery, setServerQuery] = createSignal('');
    const [active, setActive] = createSignal(true);
    const [cached, setCached] = createSignal<CrmContactEntity[]>([]);
    const [pages, setPages] = createSignal<CrmContactEntity[][]>();
    const [error, setError] = createSignal<Error>();
    const [loadingMore, setLoadingMore] = createSignal(false);
    const queuedPages: CrmContactEntity[][] = [];
    const serverLoadMore = vi.fn(async () => {
      setLoadingMore(true);
      await Promise.resolve();
      batch(() => {
        setPages((loaded) => [...(loaded ?? []), queuedPages.shift() ?? []]);
        setLoadingMore(false);
      });
    });
    const refresh = vi.fn(async () => {});
    const discovery = createContactDiscovery({
      query,
      active,
      cached: {
        contacts: cached,
        isLoading: () => false,
        hasMore: () => false,
        isLoadingMore: () => false,
        loadMore: async () => {},
      },
      server: {
        query: serverQuery,
        contacts: () => pages()?.flat(),
        error,
        isLoading: () => pages() === undefined,
        hasMore: () => queuedPages.length > 0,
        isLoadingMore: loadingMore,
        loadMore: serverLoadMore,
        refresh,
      },
    });
    const search = (text: string) =>
      batch(() => {
        setQuery(text);
        setServerQuery(text);
      });
    return {
      discovery,
      ids: () => discovery.contacts().map(({ id }) => id),
      setQuery,
      setServerQuery,
      search,
      setActive,
      setCached,
      setPages,
      setError,
      queuedPages,
      serverLoadMore,
      refresh,
    };
  });
}

describe('contact discovery', () => {
  it('shows cached matches at once and adds uncached server contacts once the query settles', () => {
    const t = setup();
    t.setCached([contact('cached-asher', { name: 'Asher' })]);
    t.setQuery('asher');
    expect(t.ids()).toEqual(['cached-asher']);
    expect(t.discovery.isLoading()).toBe(false);

    batch(() => {
      t.setServerQuery('asher');
      t.setPages([
        [
          contact('cached-asher', {
            name: 'Asher',
            lastInteraction: '2026-04-01T00:00:00Z',
          }),
          contact('beyond-seed', {
            name: 'Asher Two',
            lastInteraction: '2025-01-01T00:00:00Z',
          }),
        ],
      ]);
    });
    expect(t.ids()).toEqual(['cached-asher', 'beyond-seed']);
    expect(t.discovery.contacts()[0].lastInteraction).toBe(
      '2026-04-01T00:00:00Z'
    );
  });

  it('reports loading instead of an empty result while the server query is still settling', () => {
    const t = setup();
    t.setQuery('ash');
    expect(t.discovery.contacts()).toEqual([]);
    expect(t.discovery.isLoading()).toBe(true);
    batch(() => {
      t.setServerQuery('ash');
      t.setPages([[]]);
    });
    expect(t.discovery.isLoading()).toBe(false);
  });

  it('never shows or pages an earlier answer the live query no longer matches', async () => {
    const t = setup();
    t.search('ash');
    t.setPages([
      [
        contact('ashley', { name: 'Ashley' }),
        contact('asher', { name: 'Asher' }),
      ],
    ]);
    t.queuedPages.push([contact('ash-page-2', { name: 'Ash Two' })]);
    expect(t.ids()).toEqual(['ashley', 'asher']);

    t.setQuery('asher');
    expect(t.ids()).toEqual(['asher']);
    expect(t.discovery.hasMore()).toBe(false);
    await t.discovery.loadMore();
    expect(t.serverLoadMore).not.toHaveBeenCalled();

    // The settled query's first page is pending: keep rows that still match.
    batch(() => {
      t.setServerQuery('asher');
      t.setPages(undefined);
    });
    expect(t.ids()).toEqual(['asher']);
    t.setPages([[contact('asher-b', { name: 'Asher B' })]]);
    expect(t.ids()).toEqual(['asher-b']);

    t.setQuery('bob');
    expect(t.ids()).toEqual([]);
  });

  it('exposes nothing while inactive and does not resurface the closed search', async () => {
    const t = setup();
    t.search('asher');
    t.setPages([[contact('asher', { name: 'Asher' })]]);
    t.setError(new Error('boom'));
    t.queuedPages.push([contact('next')]);
    t.setActive(false);
    expect(t.ids()).toEqual([]);
    expect(t.discovery.error()).toBeUndefined();
    expect(t.discovery.hasMore()).toBe(false);
    await t.discovery.loadMore();
    await t.discovery.refresh();
    expect(t.serverLoadMore).not.toHaveBeenCalled();
    expect(t.refresh).not.toHaveBeenCalled();

    // Reopened with a different query before the server catches up.
    batch(() => {
      t.setActive(true);
      t.setQuery('zed');
    });
    expect(t.ids()).toEqual([]);
  });

  it('loads past pages holding only duplicates without overlapping requests', async () => {
    const t = setup();
    t.search('pat');
    t.setPages([[contact('pat', { email: 'pat@x.com' })]]);
    t.queuedPages.push(
      [
        contact('pat-other-team', {
          email: ' PAT@x.com',
          lastInteraction: '2024-01-01T00:00:00Z',
        }),
      ],
      [contact('patricia', { email: 'patricia@x.com' })]
    );
    expect(t.discovery.hasMore()).toBe(true);

    await Promise.all([t.discovery.loadMore(), t.discovery.loadMore()]);
    expect(t.serverLoadMore).toHaveBeenCalledTimes(2);
    expect(t.ids()).toEqual(['patricia', 'pat']);
    expect(t.discovery.hasMore()).toBe(false);
  });

  it('stops paging the earlier query once the query changes', async () => {
    const t = setup();
    t.search('pat');
    t.setPages([[contact('pat')]]);
    t.queuedPages.push([contact('pat')], [contact('pat-2')]);
    t.serverLoadMore.mockImplementationOnce(async () => {
      t.setQuery('patr');
      t.setPages((loaded) => [...(loaded ?? []), t.queuedPages.shift() ?? []]);
    });
    await t.discovery.loadMore();
    expect(t.serverLoadMore).toHaveBeenCalledTimes(1);
  });

  it('surfaces server failures and refreshes only while active', async () => {
    const t = setup();
    t.search('pat');
    const failure = new Error('CRM unavailable');
    t.setError(failure);
    expect(t.discovery.error()).toBe(failure);
    await t.discovery.refresh();
    expect(t.refresh).toHaveBeenCalledOnce();
  });
});
