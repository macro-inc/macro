import { arrayEquals } from '@core/util/compareUtils';
import { type ChannelEntity, isChannelEntity } from '@entity';
import {
  type Accessor,
  batch,
  createComputed,
  createMemo,
  createRoot,
  createSignal,
  getOwner,
  onCleanup,
  untrack,
} from 'solid-js';
import { useQueryAccount } from '../auth/use-query-account';
import { queryReadyGate } from '../gate';
import type { SoupAstItemsQuery } from '../soup/items';
import { useChannelsByIdsQuery } from './by-ids';

/** The most channel records one window resolves, however large its lists. */
export const MAX_CHANNEL_WINDOW_IDS = 200;
/** IDs per by-ID lookup; a window that slides keeps the chunks it still covers. */
export const CHANNEL_WINDOW_CHUNK_SIZE = 25;
/** The most lookups one window makes, however many sparse lists it spans. */
export const MAX_CHANNEL_WINDOW_CHUNKS = 16;
/** Records kept after their IDs leave the window, so off-screen rows stay. */
const RETAINED_CHANNELS = 1_000;

declare const channelIdWindowBrand: unique symbol;

/** Part of a window: one list, such as a section, favorites or search results. */
export type ChannelWindowSlice = {
  /** Stable name of the list, such as `favorites` or `section:<id>`. */
  key: string;
  /** The list's IDs in its own order; only those in `range` are resolved. */
  ids: readonly string[];
  /**
   * Indexes `[start, end)` of `ids` on screen. The window widens it to whole
   * blocks of `CHANNEL_WINDOW_CHUNK_SIZE`, so scrolling inside a block changes
   * nothing and crossing one swaps a single chunk. Omitted: from the start.
   */
  range?: { start: number; end: number };
  /** IDs another source already holds: they keep their place, unrequested. */
  isLoaded?: (id: string) => boolean;
};

export type ChannelWindowChunk = {
  readonly key: string;
  readonly ids: readonly string[];
};

/**
 * A bounded set of channel IDs to resolve, built only by `channelIdWindow`:
 * at most `MAX_CHANNEL_WINDOW_IDS` IDs, in at most
 * `MAX_CHANNEL_WINDOW_CHUNKS` chunks of at most `CHANNEL_WINDOW_CHUNK_SIZE`.
 */
export type ChannelIdWindow = {
  readonly [channelIdWindowBrand]: true;
  readonly chunks: readonly ChannelWindowChunk[];
  readonly size: number;
  /** IDs in range left out to stay within the caps. */
  readonly dropped: number;
};

/**
 * Blocks per region, coarsest first: a region whose IDs fit one chunk is
 * looked up as one, so a sparse list makes few chunks. Regions are aligned to
 * their size, so a region keeps its key until its count crosses a chunk.
 */
const REGION_BLOCKS = [64, 8] as const;

/**
 * Build a window from slices in priority order. Each slice is cut into
 * blocks of `CHANNEL_WINDOW_CHUNK_SIZE` indexes, keyed `<slice key>:<block>`,
 * so one list growing or scrolling never moves another's chunks. Neighbouring
 * blocks with few IDs left to look up (the rest held elsewhere) share a chunk
 * for their aligned region of 8 or 64 blocks, keyed
 * `<slice key>:<blocks>x<region>`; a region with IDs in one block only keeps
 * that block's key. An ID in several slices is resolved by
 * the first; IDs past `limit` (at most `MAX_CHANNEL_WINDOW_IDS`), and those
 * of chunks past `MAX_CHANNEL_WINDOW_CHUNKS`, are dropped, never queued for
 * later.
 */
export function channelIdWindow(
  slices: readonly ChannelWindowSlice[],
  limit: number = MAX_CHANNEL_WINDOW_IDS
): ChannelIdWindow {
  const cap = Math.max(0, Math.min(limit, MAX_CHANNEL_WINDOW_IDS));
  const taken = new Set<string>();
  const chunks: ChannelWindowChunk[] = [];
  let dropped = 0;
  for (const slice of slices) {
    const start = Math.max(0, slice.range?.start ?? 0);
    const end = Math.min(slice.ids.length, slice.range?.end ?? Infinity);
    if (end <= start) continue;
    const firstBlock = Math.floor(start / CHANNEL_WINDOW_CHUNK_SIZE);
    const lastBlock = Math.floor((end - 1) / CHANNEL_WINDOW_CHUNK_SIZE);
    const blocks = new Map<number, string[]>();
    for (let block = firstBlock; block <= lastBlock; block += 1) {
      const ids: string[] = [];
      const blockEnd = Math.min(
        slice.ids.length,
        (block + 1) * CHANNEL_WINDOW_CHUNK_SIZE
      );
      for (
        let index = block * CHANNEL_WINDOW_CHUNK_SIZE;
        index < blockEnd;
        index += 1
      ) {
        const id = slice.ids[index];
        if (taken.has(id) || slice.isLoaded?.(id)) continue;
        if (taken.size >= cap) {
          dropped += 1;
          continue;
        }
        taken.add(id);
        ids.push(id);
      }
      if (ids.length > 0) blocks.set(block, ids);
    }
    const pack = (level: number, region: number) => {
      const size = REGION_BLOCKS[level];
      const ids: string[] = [];
      const holding: number[] = [];
      for (let block = region * size; block < (region + 1) * size; block += 1) {
        const blockIds = blocks.get(block);
        if (!blockIds) continue;
        ids.push(...blockIds);
        holding.push(block);
      }
      if (holding.length === 0) return;
      // A region of one block keeps that block's key as it grows or shrinks.
      if (holding.length === 1) {
        chunks.push({ key: `${slice.key}:${holding[0]}`, ids });
        return;
      }
      if (ids.length <= CHANNEL_WINDOW_CHUNK_SIZE) {
        chunks.push({ key: `${slice.key}:${size}x${region}`, ids });
        return;
      }
      const next = REGION_BLOCKS[level + 1];
      if (next === undefined) {
        for (const block of holding) {
          chunks.push({
            key: `${slice.key}:${block}`,
            ids: blocks.get(block) ?? [],
          });
        }
        return;
      }
      const parts = size / next;
      for (let part = 0; part < parts; part += 1) {
        pack(level + 1, region * parts + part);
      }
    };
    const coarsest = REGION_BLOCKS[0];
    for (
      let region = Math.floor(firstBlock / coarsest);
      region <= Math.floor(lastBlock / coarsest);
      region += 1
    ) {
      pack(0, region);
    }
  }
  // Each chunk is one lookup, so a window over many sparse lists stops at
  // the chunk cap too; its IDs count as dropped.
  const kept = chunks.slice(0, MAX_CHANNEL_WINDOW_CHUNKS);
  for (const chunk of chunks.slice(MAX_CHANNEL_WINDOW_CHUNKS)) {
    dropped += chunk.ids.length;
  }
  const size = kept.reduce((total, chunk) => total + chunk.ids.length, 0);
  return { chunks: kept, size, dropped } as unknown as ChannelIdWindow;
}

export const EMPTY_CHANNEL_WINDOW = channelIdWindow([]);

type WindowChunk = {
  key: string;
  ids: Accessor<readonly string[]>;
  setIds: (next: readonly string[]) => void;
  query: SoupAstItemsQuery;
  channels: Accessor<ChannelEntity[]>;
  unresolved: Accessor<string[]>;
  error: Accessor<Error | null | undefined>;
  loading: Accessor<boolean>;
  dispose: () => void;
};

export type ChannelWindowResult = {
  /** Records of the window's IDs, kept current while they are in it. */
  channels: Accessor<ChannelEntity[]>;
  /**
   * The last record of each ID that left a chunk, newest first and at most a
   * thousand, so a row that scrolled away keeps its place, and one moving to
   * another chunk keeps its record until that chunk returns it. Not kept
   * current.
   */
  retained: Accessor<ChannelEntity[]>;
  pendingIds: Accessor<ReadonlySet<string>>;
  failedIds: Accessor<ReadonlySet<string>>;
  /** IDs a settled lookup did not return; kept after they leave the window. */
  unavailableIds: Accessor<ReadonlySet<string>>;
  isLoading: Accessor<boolean>;
  error: Accessor<Error | null | undefined>;
  retry: () => Promise<void>;
};

/**
 * Resolve a bounded window of channel IDs, one cached by-ID lookup per chunk.
 * Chunks that stay in the window keep their lookup, which asks again only
 * when a chunk gains an ID; a chunk that leaves stops being fetched or kept
 * current, so each lookup holds at most `CHANNEL_WINDOW_CHUNK_SIZE` IDs.
 */
export function useChannelWindow(
  window: Accessor<ChannelIdWindow>,
  enabled: Accessor<boolean>
): ChannelWindowResult {
  const owner = getOwner();
  const account = useQueryAccount();
  const [chunks, setChunks] = createSignal<readonly WindowChunk[]>([]);
  const [retainedRows, setRetainedRows] = createSignal<
    readonly ChannelEntity[]
  >([]);
  const [retainedMissing, setRetainedMissing] = createSignal<readonly string[]>(
    []
  );
  let active = new Map<string, WindowChunk>();
  let currentAccount: ReturnType<typeof account>;

  const createChunk = (key: string, initial: readonly string[]) =>
    createRoot((dispose): WindowChunk => {
      const [ids, setWanted] = createSignal<readonly string[]>(initial, {
        equals: arrayEquals,
      });
      // The IDs the lookup asked for: a chunk whose IDs only shrink (another
      // source loaded some) keeps its lookup instead of asking again.
      const [lookupIds, setLookupIds] = createSignal<readonly string[]>(
        initial,
        { equals: arrayEquals }
      );
      const setIds = (next: readonly string[]) => {
        setWanted(next);
        const asked = new Set(untrack(lookupIds));
        if (!next.every((id) => asked.has(id))) setLookupIds(next);
      };
      const idSet = createMemo(() => new Set(ids()));
      const query = useChannelsByIdsQuery(lookupIds, () => ({
        cacheFirst: true,
      }));
      const error = () => query.fetchError ?? query.error;
      const loading = () =>
        !error() &&
        (query.isPending ||
          query.isFetching ||
          query.hasNextPage ||
          query.cacheStatus === 'loading');
      // A refetch keeps the rows it already had for IDs still in the chunk,
      // and so does a new lookup the cache answers in part: an ID the cache
      // lacks keeps its last record until a network page or an error settles
      // it (the cache answers before the network lookup starts).
      const channels = createMemo<ChannelEntity[]>((previous) => {
        const activeIds = idSet();
        if (!queryReadyGate(query)) {
          return previous.filter((channel) => activeIds.has(channel.id));
        }
        const rows = query.data.entities.filter(
          (entity): entity is ChannelEntity =>
            isChannelEntity(entity) && activeIds.has(entity.id)
        );
        if (error() || (!loading() && query.hasPageData)) return rows;
        const returned = new Set(rows.map((row) => row.id));
        return [
          ...rows,
          ...previous.filter(
            (channel) => activeIds.has(channel.id) && !returned.has(channel.id)
          ),
        ];
      }, []);
      const unresolved = createMemo(() => {
        const loaded = new Set(channels().map((channel) => channel.id));
        return ids().filter((id) => !loaded.has(id));
      });
      return {
        key,
        ids,
        setIds,
        query,
        channels,
        unresolved,
        error,
        loading,
        dispose,
      };
    }, owner ?? undefined);

  const settledMissing = (chunk: WindowChunk) =>
    chunk.query.hasPageData && !chunk.loading() && !chunk.error()
      ? chunk.unresolved()
      : [];

  // Keep what leaving IDs showed: their last record, or that they are gone,
  // whichever is newer.
  const retain = (
    rows: readonly ChannelEntity[],
    missing: readonly string[]
  ) => {
    if (rows.length > 0) {
      const ids = new Set(rows.map((row) => row.id));
      setRetainedRows((previous) =>
        [...rows, ...previous.filter((row) => !ids.has(row.id))].slice(
          0,
          RETAINED_CHANNELS
        )
      );
      setRetainedMissing((previous) =>
        previous.some((id) => ids.has(id))
          ? previous.filter((id) => !ids.has(id))
          : previous
      );
    }
    if (missing.length > 0) {
      const ids = new Set(missing);
      setRetainedMissing((previous) =>
        [...missing, ...previous.filter((id) => !ids.has(id))].slice(
          0,
          RETAINED_CHANNELS
        )
      );
      setRetainedRows((previous) =>
        previous.some((row) => ids.has(row.id))
          ? previous.filter((row) => !ids.has(row.id))
          : previous
      );
    }
  };

  const disposeAll = () => {
    for (const chunk of active.values()) chunk.dispose();
    active = new Map();
  };

  createComputed(() => {
    const isEnabled = enabled();
    const nextAccount = account();
    // A disabled window is never built, so its inputs may not exist yet.
    const next = isEnabled && nextAccount ? window() : EMPTY_CHANNEL_WINDOW;
    untrack(() => {
      if (!isEnabled || !nextAccount || currentAccount !== nextAccount) {
        disposeAll();
        batch(() => {
          setChunks([]);
          setRetainedRows([]);
          setRetainedMissing([]);
        });
        currentAccount = isEnabled ? nextAccount : undefined;
        if (!isEnabled || !nextAccount) return;
      }
      const wanted = new Map(next.chunks.map((chunk) => [chunk.key, chunk]));
      const nextActive = new Map<string, WindowChunk>();
      batch(() => {
        for (const [key, chunk] of active) {
          const keep = wanted.get(key);
          if (!keep) {
            retain(chunk.channels(), settledMissing(chunk));
            chunk.dispose();
            continue;
          }
          const keepIds = new Set(keep.ids);
          retain(
            chunk.channels().filter((row) => !keepIds.has(row.id)),
            settledMissing(chunk).filter((id) => !keepIds.has(id))
          );
          chunk.setIds(keep.ids);
          nextActive.set(key, chunk);
        }
        for (const chunk of next.chunks) {
          if (!nextActive.has(chunk.key)) {
            nextActive.set(chunk.key, createChunk(chunk.key, chunk.ids));
          }
        }
        const previous = untrack(chunks);
        const nextChunks = [...nextActive.values()];
        active = nextActive;
        if (!arrayEquals(previous, nextChunks)) setChunks(nextChunks);
      });
    });
  });

  onCleanup(disposeAll);

  const channels = createMemo(() =>
    chunks().flatMap((chunk) => chunk.channels())
  );
  const liveIds = createMemo(
    () => new Set(chunks().flatMap((chunk) => chunk.ids()))
  );
  // Rows read these once each, so each set is built once per change.
  const pendingIds = createMemo<ReadonlySet<string>>(
    () =>
      new Set(
        chunks().flatMap((chunk) => (chunk.loading() ? chunk.unresolved() : []))
      )
  );
  const failedIds = createMemo<ReadonlySet<string>>(
    () =>
      new Set(
        chunks().flatMap((chunk) => (chunk.error() ? chunk.unresolved() : []))
      )
  );
  const unavailableIds = createMemo<ReadonlySet<string>>(() => {
    const live = liveIds();
    return new Set([
      ...chunks().flatMap(settledMissing),
      ...retainedMissing().filter((id) => !live.has(id)),
    ]);
  });
  return {
    channels,
    // A record goes once a settled lookup no longer returns its channel.
    retained: createMemo(() => {
      const returned = new Set(channels().map((channel) => channel.id));
      const unavailable = unavailableIds();
      return retainedRows().filter(
        (row) => !returned.has(row.id) && !unavailable.has(row.id)
      );
    }),
    pendingIds,
    failedIds,
    unavailableIds,
    isLoading: () =>
      chunks().some(
        (chunk) => chunk.loading() && chunk.unresolved().length > 0
      ),
    error: () =>
      chunks()
        .find((chunk) => chunk.error() && chunk.unresolved().length > 0)
        ?.error(),
    retry: async () => {
      await Promise.all(
        chunks()
          .filter((chunk) => chunk.error() && chunk.unresolved().length > 0)
          .map((chunk) => chunk.query.refresh())
      );
    },
  };
}
