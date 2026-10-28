import type { EntryState } from '@components/app/split-layout/layoutManager';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { EntitySearchCategory } from '../queries/entity-search';
import { createSearchScrollRestoration } from './create-search-scroll-restoration';

const history = vi.hoisted(() => ({
  state: undefined as EntryState | undefined,
  read: undefined as (() => unknown) | undefined,
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    handle: {
      currentEntryState: () => history.state,
      registerEntryStateCaptor: (_key: string, read: () => unknown) => {
        history.read = read;
        return () => {
          history.read = undefined;
        };
      },
    },
  }),
}));
let dispose: (() => void) | undefined;
beforeEach(() => {
  history.state = undefined;
  history.read = undefined;
});
afterEach(() => dispose?.());

function setup() {
  return createRoot((stop) => {
    dispose = stop;
    const [items, setItems] = createSignal<string[]>(['first']);
    const [accountId, setAccountId] = createSignal('alice');
    const [query, setQuery] = createSignal('notes');
    const [category, setCategory] = createSignal<EntitySearchCategory>('all');
    const [ready, setReady] = createSignal(true);
    const [busy, setBusy] = createSignal(false);
    const [failed, setFailed] = createSignal(false);
    const [hasMore, setHasMore] = createSignal(true);
    const loadMore = vi.fn(async () => {});
    const apply = vi.fn(
      (anchor: { id?: string; offset: number; within: number }) =>
        !anchor.id || items().includes(anchor.id)
    );
    const restoration = createSearchScrollRestoration({
      key: 'scroll',
      accountId,
      query,
      category,
      items,
      ready,
      busy,
      failed,
      hasMore,
      loadMore,
      apply,
      read: () => ({ id: 'first', offset: 40, within: 4 }),
    });
    return {
      restoration,
      setItems,
      setAccountId,
      setQuery,
      setCategory,
      setReady,
      setBusy,
      setFailed,
      setHasMore,
      loadMore,
      apply,
    };
  });
}

it('captures only a scoped item anchor and pixel offsets', () => {
  setup();
  expect(history.read?.()).toEqual({
    accountId: 'alice',
    query: 'notes',
    category: 'all',
    id: 'first',
    offset: 40,
    within: 4,
  });
});

it('waits for rows and layout, then restores an anchor from a later page once', async () => {
  history.state = {
    scroll: {
      accountId: 'alice',
      query: 'notes',
      category: 'all',
      id: 'target',
      offset: 500,
      within: 8,
    },
  };
  const view = setup();
  view.setReady(false);
  await Promise.resolve();
  expect(view.loadMore).not.toHaveBeenCalled();
  view.loadMore.mockImplementation(async () => {
    view.setItems(['first', 'target']);
  });
  view.setReady(true);
  await vi.waitFor(() => expect(view.restoration.pending()).toBe(false));
  expect(view.loadMore).toHaveBeenCalledOnce();
  expect(view.apply).toHaveBeenLastCalledWith(
    expect.objectContaining({ id: 'target', within: 8 })
  );
  const calls = view.apply.mock.calls.length;
  view.setItems(['first', 'target', 'third']);
  await Promise.resolve();
  expect(view.apply).toHaveBeenCalledTimes(calls);
});

it('limits automatic recovery to three additional pages when the anchor disappeared', async () => {
  history.state = {
    scroll: {
      accountId: 'alice',
      query: 'notes',
      category: 'all',
      id: 'missing',
      offset: 500,
      within: 8,
    },
  };
  const view = setup();
  view.loadMore.mockImplementation(async () => {
    view.setItems(['new-page']);
  });
  await vi.waitFor(() => expect(view.restoration.pending()).toBe(false));
  expect(view.loadMore).toHaveBeenCalledTimes(3);
  expect(view.apply).toHaveBeenLastCalledWith({ offset: 500, within: 0 });
  expect(view.restoration.paginationAllowed()).toBe(false);
  view.restoration.cancel();
  expect(view.restoration.paginationAllowed()).toBe(true);
});

it('does not repeatedly fetch an unchanged or exhausted page', async () => {
  history.state = {
    scroll: {
      accountId: 'alice',
      query: 'notes',
      category: 'all',
      id: 'missing',
      offset: 500,
      within: 8,
    },
  };
  const view = setup();
  await vi.waitFor(() => expect(view.restoration.pending()).toBe(false));
  expect(view.loadMore).toHaveBeenCalledOnce();
});

it.each(['account', 'query', 'user', 'dispose', 'failure'])(
  'cannot scroll or fetch after %s cancels a pending restoration',
  async (reason) => {
    history.state = {
      scroll: {
        accountId: 'alice',
        query: 'notes',
        category: 'all',
        id: 'target',
        offset: 500,
        within: 8,
      },
    };
    const view = setup();
    view.setBusy(true);
    if (reason === 'account') view.setAccountId('bob');
    if (reason === 'query') view.setQuery('different');
    if (reason === 'user') view.restoration.cancel();
    if (reason === 'dispose') dispose?.();
    if (reason === 'failure') view.setFailed(true);
    view.setBusy(false);
    view.setItems(['target']);
    await Promise.resolve();
    expect(view.loadMore).not.toHaveBeenCalled();
    expect(view.apply).not.toHaveBeenCalled();
  }
);

it('ignores an in-flight page completion after the user changes query', async () => {
  history.state = {
    scroll: {
      accountId: 'alice',
      query: 'notes',
      category: 'all',
      id: 'target',
      offset: 500,
      within: 8,
    },
  };
  const view = setup();
  const page = Promise.withResolvers<void>();
  view.loadMore.mockImplementation(() => page.promise);
  await vi.waitFor(() => expect(view.loadMore).toHaveBeenCalledOnce());
  view.setQuery('another search');
  const calls = view.apply.mock.calls.length;
  view.setItems(['target']);
  page.resolve();
  await page.promise;
  await Promise.resolve();
  expect(view.apply).toHaveBeenCalledTimes(calls);
  expect(view.loadMore).toHaveBeenCalledOnce();
});

it.each(['query', 'category'] as const)(
  'resumes ordinary pagination when %s changes after restoration finished',
  async (field) => {
    history.state = {
      scroll: {
        accountId: 'alice',
        query: 'notes',
        category: 'all',
        id: 'first',
        offset: 0,
        within: 0,
      },
    };
    const view = setup();
    await vi.waitFor(() => expect(view.restoration.pending()).toBe(false));
    expect(view.restoration.paginationAllowed()).toBe(false);
    if (field === 'query') view.setQuery('another search');
    else view.setCategory('email');
    expect(view.restoration.paginationAllowed()).toBe(true);
  }
);
