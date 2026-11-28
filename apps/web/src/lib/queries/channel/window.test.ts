import type { ChannelEntity } from '@entity/types/entity';
import { batch, createRoot, createSignal, onCleanup } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const useSoupAstItemsQuery = vi.hoisted(() => vi.fn());

vi.mock('@queries/soup/items', () => ({ useSoupAstItemsQuery }));
vi.mock('../soup/items', () => ({ useSoupAstItemsQuery }));
vi.mock('@entity', () => ({
  isChannelEntity: (entity: { type: string }) => entity.type === 'channel',
}));
const userIdMock = vi.hoisted(() => ({
  get: (): string => 'user-1',
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => userIdMock.get(),
  useIsAuthenticated: () => () => true,
}));
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return { queryClient: new QueryClient() };
});

import {
  CHANNEL_WINDOW_CHUNK_SIZE,
  type ChannelIdWindow,
  channelIdWindow,
  EMPTY_CHANNEL_WINDOW,
  MAX_CHANNEL_WINDOW_IDS,
  useChannelWindow,
} from './window';

const ids = (count: number, prefix = 'ch') =>
  Array.from(
    { length: count },
    (_, index) => `${prefix}-${String(index).padStart(4, '0')}`
  );

const channelEntity = (id: string) =>
  ({ id, type: 'channel', name: id, channelType: 'team' }) as ChannelEntity;

/**
 * A lookup that returns every requested ID except those in `missing`; one
 * created for an ID in `slow` never answers.
 */
function fakeLookups(
  missing: ReadonlySet<string> = new Set(),
  slow: ReadonlySet<string> = new Set()
) {
  const requested: string[][] = [];
  const disposed: string[][] = [];
  /** What each lookup asks for now. */
  const asking: Array<() => string[]> = [];
  useSoupAstItemsQuery.mockImplementation((args) => {
    const requestedIds = (): string[] =>
      JSON.stringify(args().body).match(/ch-\d{4}|fav-\d{4}/g) ?? [];
    const initial = requestedIds();
    const pending = initial.some((id) => slow.has(id));
    requested.push(initial);
    asking.push(requestedIds);
    onCleanup(() => disposed.push(initial));
    return {
      isEnabled: true,
      isPending: pending,
      isLoading: pending,
      isFetching: pending,
      hasPageData: !pending,
      hasNextPage: false,
      refresh: async () => {},
      get data() {
        if (pending) return undefined;
        return {
          entities: requestedIds()
            .filter((id) => !missing.has(id))
            .map(channelEntity),
        };
      },
    };
  });
  return { requested, disposed, asking };
}

afterEach(() => {
  useSoupAstItemsQuery.mockReset();
});

describe('channelIdWindow', () => {
  it('keys each slice by its own blocks, widened from the range on screen', () => {
    const window = channelIdWindow([
      { key: 'section:a', ids: ids(100), range: { start: 30, end: 55 } },
      { key: 'section:b', ids: ids(10, 'fav') },
    ]);
    expect(window.chunks.map((chunk) => chunk.key)).toEqual([
      'section:a:1',
      'section:a:2',
      'section:b:0',
    ]);
    expect(window.chunks[0].ids).toEqual(ids(50).slice(25, 50));
    expect(window.chunks[1].ids).toEqual(ids(75).slice(50, 75));
    expect(window.size).toBe(60);
    expect(window.dropped).toBe(0);
  });

  it('keeps a chunk unchanged while scrolling inside its block', () => {
    const list = ids(100);
    const before = channelIdWindow([
      { key: 's', ids: list, range: { start: 26, end: 40 } },
    ]);
    const after = channelIdWindow([
      { key: 's', ids: list, range: { start: 30, end: 49 } },
    ]);
    expect(after.chunks).toEqual(before.chunks);
  });

  it('skips loaded IDs, resolves an overlap once, and caps the total', () => {
    const loaded = new Set(['ch-0001']);
    const window = channelIdWindow([
      { key: 'favorites', ids: ['ch-0002'] },
      {
        key: 'section:a',
        ids: ids(400),
        range: { start: 0, end: 400 },
        isLoaded: (id) => loaded.has(id),
      },
    ]);
    const all = window.chunks.flatMap((chunk) => chunk.ids);
    expect(all).toHaveLength(MAX_CHANNEL_WINDOW_IDS);
    expect(new Set(all).size).toBe(all.length);
    expect(all).not.toContain('ch-0001');
    expect(window.chunks[0]).toEqual({ key: 'favorites:0', ids: ['ch-0002'] });
    expect(window.dropped).toBe(400 - 2 - (MAX_CHANNEL_WINDOW_IDS - 1));
    for (const chunk of window.chunks) {
      expect(chunk.ids.length).toBeLessThanOrEqual(CHANNEL_WINDOW_CHUNK_SIZE);
    }
  });

  it('never exceeds the cap, even when asked for more', () => {
    const window = channelIdWindow([{ key: 's', ids: ids(1000) }], 5000);
    expect(window.size).toBe(MAX_CHANNEL_WINDOW_IDS);
  });

  it('resolves nothing for an empty range', () => {
    const window = channelIdWindow([
      { key: 's', ids: ids(100), range: { start: 10, end: 10 } },
    ]);
    expect(window.chunks).toEqual([]);
  });
});

describe('useChannelWindow', () => {
  it('keeps chunks still in the window and retains rows that left it', () => {
    const { requested, disposed } = fakeLookups();
    const list = ids(200);
    const { dispose, result, setRange } = createRoot((dispose) => {
      const [range, setRange] = createSignal({ start: 0, end: 30 });
      const result = useChannelWindow(
        () => channelIdWindow([{ key: 's', ids: list, range: range() }]),
        () => true
      );
      return { dispose, result, setRange };
    });
    try {
      expect(requested).toHaveLength(2);
      expect(result.channels()).toHaveLength(50);
      setRange({ start: 40, end: 70 });
      // Block 1 stays mounted; block 0 leaves and block 2 arrives.
      expect(requested).toHaveLength(3);
      expect(disposed).toEqual([list.slice(0, 25)]);
      expect(result.channels().map(({ id }) => id)).toEqual(list.slice(25, 75));
      expect(result.retained().map(({ id }) => id)).toEqual(list.slice(0, 25));
      setRange({ start: 0, end: 10 });
      expect(result.retained().map(({ id }) => id)).not.toContain(list[0]);
    } finally {
      dispose();
    }
    expect(disposed).toHaveLength(4);
  });

  it('keeps a lookup while its chunk only loses IDs, and asks again for a new one', () => {
    const { requested, asking } = fakeLookups();
    const list = ids(10);
    const { dispose, result, setLoaded } = createRoot((dispose) => {
      const [loaded, setLoaded] = createSignal<readonly string[]>([]);
      const result = useChannelWindow(
        () =>
          channelIdWindow([
            {
              key: 's',
              ids: list,
              isLoaded: (id) => loaded().includes(id),
            },
          ]),
        () => true
      );
      return { dispose, result, setLoaded };
    });
    try {
      setLoaded(list.slice(0, 4));
      expect(requested).toHaveLength(1);
      expect(asking[0]?.()).toEqual(list);
      expect(result.channels().map(({ id }) => id)).toEqual(list.slice(4));
      setLoaded(list.slice(0, 2));
      expect(asking[0]?.()).toEqual(list);
      setLoaded([]);
      expect(asking[0]?.()).toEqual(list);
      expect(result.channels().map(({ id }) => id)).toEqual(list);
    } finally {
      dispose();
    }
    const grown = createRoot((dispose) => {
      const [count, setCount] = createSignal(3);
      useChannelWindow(
        () => channelIdWindow([{ key: 's', ids: list.slice(0, count()) }]),
        () => true
      );
      return { dispose, setCount };
    });
    try {
      grown.setCount(4);
      expect(asking.at(-1)?.()).toEqual(list.slice(0, 4));
    } finally {
      grown.dispose();
    }
  });

  it('keeps a record while its ID moves to a chunk that is still loading', () => {
    const slow = new Set<string>();
    fakeLookups(new Set(), slow);
    const { dispose, result, setKey } = createRoot((dispose) => {
      const [key, setKey] = createSignal('first');
      const result = useChannelWindow(
        () => channelIdWindow([{ key: key(), ids: ['ch-0001'] }]),
        () => true
      );
      return { dispose, result, setKey };
    });
    try {
      expect(result.channels().map(({ id }) => id)).toEqual(['ch-0001']);
      slow.add('ch-0001');
      setKey('second');
      expect(result.channels()).toEqual([]);
      expect([...result.pendingIds()]).toEqual(['ch-0001']);
      expect(result.retained().map(({ id }) => id)).toEqual(['ch-0001']);
    } finally {
      dispose();
    }
  });

  it('reports unavailable IDs after they leave the window', () => {
    fakeLookups(new Set(['ch-0003']));
    const { dispose, result, setWindow } = createRoot((dispose) => {
      const [window, setWindow] = createSignal<ChannelIdWindow>(
        channelIdWindow([{ key: 's', ids: ids(5) }])
      );
      return {
        dispose,
        result: useChannelWindow(window, () => true),
        setWindow,
      };
    });
    try {
      expect([...result.unavailableIds()]).toEqual(['ch-0003']);
      expect(result.isLoading()).toBe(false);
      setWindow(channelIdWindow([{ key: 'other', ids: ['ch-0009'] }]));
      expect([...result.unavailableIds()]).toEqual(['ch-0003']);
    } finally {
      dispose();
    }
  });

  it('builds and requests nothing while disabled, and drops everything when disabled', () => {
    const { requested, disposed } = fakeLookups();
    let built = 0;
    const { dispose, result, setEnabled } = createRoot((dispose) => {
      const [enabled, setEnabled] = createSignal(false);
      const result = useChannelWindow(() => {
        built += 1;
        return channelIdWindow([{ key: 's', ids: ids(10) }]);
      }, enabled);
      return { dispose, result, setEnabled };
    });
    try {
      expect(built).toBe(0);
      expect(requested).toHaveLength(0);
      setEnabled(true);
      expect(result.channels()).toHaveLength(10);
      setEnabled(false);
      expect(disposed).toHaveLength(1);
      expect(result.channels()).toEqual([]);
      expect(result.retained()).toEqual([]);
    } finally {
      dispose();
    }
  });

  it('keeps rows through a refresh without reading pending data', () => {
    const resolved = [channelEntity('ch-0000'), channelEntity('ch-0001')];
    const { dispose, result, setPending, setEntities, setWindow } = createRoot(
      (dispose) => {
        const [pending, setPending] = createSignal(false);
        const [entities, setEntities] = createSignal(resolved);
        const [window, setWindow] = createSignal(
          channelIdWindow([{ key: 's', ids: ids(2) }])
        );
        useSoupAstItemsQuery.mockImplementation(() => ({
          isEnabled: true,
          isLoading: false,
          isFetching: false,
          hasNextPage: false,
          get isPending() {
            return pending();
          },
          get hasPageData() {
            return !pending();
          },
          get data() {
            if (pending()) throw new Error('A pending query resource was read');
            return { entities: entities() };
          },
        }));
        return {
          dispose,
          result: useChannelWindow(window, () => true),
          setPending,
          setEntities,
          setWindow,
        };
      }
    );
    try {
      expect(result.channels()).toEqual(resolved);
      setPending(true);
      expect(result.channels()).toEqual(resolved);
      expect([...result.pendingIds()]).toEqual([]);
      setEntities([channelEntity('ch-0001')]);
      setPending(false);
      expect(result.channels()).toEqual([channelEntity('ch-0001')]);
      setPending(true);
      setWindow(channelIdWindow([{ key: 's', ids: ['ch-0099'] }]));
      expect(result.channels()).toEqual([]);
    } finally {
      dispose();
    }
  });

  it('tells pending, failed and unavailable IDs apart, and retries failed chunks', async () => {
    const refresh = vi.fn(async () => {});
    const { result, dispose, setPending, setError } = createRoot((dispose) => {
      const [pending, setPending] = createSignal(true);
      const [error, setError] = createSignal<Error>();
      useSoupAstItemsQuery.mockImplementation(() => ({
        isEnabled: true,
        get isPending() {
          return pending();
        },
        get isLoading() {
          return pending();
        },
        get isFetching() {
          return pending();
        },
        get hasPageData() {
          return !pending();
        },
        get fetchError() {
          return error();
        },
        hasNextPage: false,
        refresh,
        get data() {
          if (pending()) throw new Error('A pending query resource was read');
          return { entities: [channelEntity('ch-0000')] };
        },
      }));
      return {
        result: useChannelWindow(
          () => channelIdWindow([{ key: 's', ids: ids(2) }]),
          () => true
        ),
        dispose,
        setPending,
        setError,
      };
    });
    try {
      expect([...result.pendingIds()].sort()).toEqual(['ch-0000', 'ch-0001']);
      expect([...result.unavailableIds()]).toEqual([]);
      setPending(false);
      expect(result.channels().map(({ id }) => id)).toEqual(['ch-0000']);
      expect([...result.unavailableIds()]).toEqual(['ch-0001']);
      setError(new Error('offline'));
      expect([...result.unavailableIds()]).toEqual([]);
      expect([...result.failedIds()]).toEqual(['ch-0001']);
      expect(result.error()).toBeInstanceOf(Error);
      await result.retry();
      expect(refresh).toHaveBeenCalledOnce();
    } finally {
      dispose();
    }
  });

  it('keeps the last record of an ID until the network settles a new lookup the cache answered without it', () => {
    const [missing, setMissing] = createSignal(false);
    const [fetching, setFetching] = createSignal(false);
    const [page, setPage] = createSignal(true);
    useSoupAstItemsQuery.mockImplementation((args) => {
      const asked = (): string[] =>
        JSON.stringify(args().body).match(/ch-\d{4}/g) ?? [];
      return {
        isEnabled: true,
        isPending: false,
        isLoading: false,
        get isFetching() {
          return fetching();
        },
        get hasPageData() {
          return page();
        },
        hasNextPage: false,
        get data() {
          return {
            entities: asked()
              .filter((id) => !(missing() && id === 'ch-0000'))
              .map(channelEntity),
          };
        },
      };
    });
    const { dispose, result, setWindow } = createRoot((dispose) => {
      const [window, setWindow] = createSignal(
        channelIdWindow([{ key: 's', ids: ids(3) }])
      );
      return {
        dispose,
        result: useChannelWindow(window, () => true),
        setWindow,
      };
    });
    const shown = () =>
      result
        .channels()
        .map(({ id }) => id)
        .sort();
    try {
      expect(shown()).toEqual(['ch-0000', 'ch-0001', 'ch-0002']);
      // The cache answers the new IDs without ch-0000 before the network
      // lookup for it starts.
      batch(() => {
        setMissing(true);
        setPage(false);
        setWindow(channelIdWindow([{ key: 's', ids: ['ch-0000', 'ch-0005'] }]));
      });
      expect(shown()).toEqual(['ch-0000', 'ch-0005']);
      setFetching(true);
      expect(shown()).toEqual(['ch-0000', 'ch-0005']);
      expect([...result.pendingIds()]).toEqual([]);
      // The network page confirms it is gone.
      batch(() => {
        setFetching(false);
        setPage(true);
      });
      expect(shown()).toEqual(['ch-0005']);
      expect([...result.unavailableIds()]).toEqual(['ch-0000']);
    } finally {
      dispose();
    }
  });

  it('keeps an ID pending while the cache is still reading it', () => {
    const { dispose, result, setCacheStatus } = createRoot((dispose) => {
      const [cacheStatus, setCacheStatus] = createSignal<'loading' | 'ready'>(
        'loading'
      );
      useSoupAstItemsQuery.mockImplementation(() => ({
        isEnabled: true,
        isPending: false,
        isLoading: false,
        isFetching: false,
        hasPageData: false,
        hasNextPage: false,
        get cacheStatus() {
          return cacheStatus();
        },
        data: { entities: [channelEntity('ch-0000')] },
      }));
      return {
        dispose,
        setCacheStatus,
        result: useChannelWindow(
          () => channelIdWindow([{ key: 's', ids: ids(2) }]),
          () => true
        ),
      };
    });
    try {
      expect(result.isLoading()).toBe(true);
      expect([...result.pendingIds()]).toEqual(['ch-0001']);
      setCacheStatus('ready');
      expect(result.isLoading()).toBe(false);
      expect([...result.pendingIds()]).toEqual([]);
    } finally {
      dispose();
    }
  });

  it('drops every record on an account switch, even to an empty window', () => {
    const [userId, setUserId] = createSignal('user-1');
    userIdMock.get = userId;
    const { disposed } = fakeLookups();
    const { dispose, result, setWindow } = createRoot((dispose) => {
      const [window, setWindow] = createSignal(
        channelIdWindow([{ key: 's', ids: ids(3) }])
      );
      return {
        dispose,
        result: useChannelWindow(window, () => true),
        setWindow,
      };
    });
    try {
      expect(result.channels()).toHaveLength(3);
      setWindow(channelIdWindow([{ key: 's', ids: ids(2) }]));
      // Switch account and empty the window in one flush, so the reset runs
      // with no chunks wanted while an account is still signed in.
      batch(() => {
        setUserId('user-2');
        setWindow(EMPTY_CHANNEL_WINDOW);
      });
      expect(disposed).toHaveLength(1);
      expect(result.channels()).toEqual([]);
      expect(result.retained()).toEqual([]);
    } finally {
      dispose();
      userIdMock.get = () => 'user-1';
    }
  });
});
