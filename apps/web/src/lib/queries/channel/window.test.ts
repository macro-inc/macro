import type { ChannelEntity } from '@entity/types/entity';
import { createRoot, createSignal, onCleanup } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const useSoupAstItemsQuery = vi.hoisted(() => vi.fn());

vi.mock('@queries/soup/items', () => ({ useSoupAstItemsQuery }));
vi.mock('../soup/items', () => ({ useSoupAstItemsQuery }));
vi.mock('@entity', () => ({
  isChannelEntity: (entity: { type: string }) => entity.type === 'channel',
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'user-1',
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
  useSoupAstItemsQuery.mockImplementation((args) => {
    const requestedIds = (): string[] =>
      JSON.stringify(args().body).match(/ch-\d{4}|fav-\d{4}/g) ?? [];
    const initial = requestedIds();
    const pending = initial.some((id) => slow.has(id));
    requested.push(initial);
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
  return { requested, disposed };
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
});
