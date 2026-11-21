import { deepEqual } from '@core/util/compareUtils';
import type { CacheHost } from '@graphql-cache/host/types';
import { readRecordsByKeys, selectRecords } from '@graphql-cache/index';
import type { SearchCursor } from '@graphql-cache/protocol';
import {
  type ChannelDirectoryFieldsFragment,
  ChannelDirectoryFieldsFragmentDoc,
} from '@service-storage/graphql/generated/graphql';
import { type DirectoryChannel, toDirectoryChannel } from './directory-core';

export const CHANNEL_RECORD_PREFIX = 'GraphqlSoupChannel:';
export const CHANNEL_SEARCH_BUCKETS = ['channel', 'dm'] as const;
const SEARCH_PAGE_LIMIT = 500;
const READ_BATCH_LIMIT = 500;
const CHANNEL_DIRECTORY_SELECTION = selectRecords(
  ChannelDirectoryFieldsFragmentDoc
);

/** A channel record the cache's search projection lists. `sourceHash`
 * changes whenever the record's own fields do. */
export type CachedChannelDocument = { recordKey: string; sourceHash: string };

/** Every channel record in the cache's search projection, deleted ones
 * excluded. A record that moves while the pages are read can be missed, so
 * an absence alone never proves a record gone. */
export async function listCachedChannelDocuments(
  host: Pick<CacheHost, 'search'>,
  signal?: AbortSignal
): Promise<CachedChannelDocument[]> {
  const documents = new Map<string, string>();
  let cursor: SearchCursor | undefined;
  do {
    signal?.throwIfAborted();
    const page = await host.search(
      {
        profile: 'quick-access-v1',
        buckets: [...CHANNEL_SEARCH_BUCKETS],
        query: '',
        limit: SEARCH_PAGE_LIMIT,
        cursor,
      },
      { signal }
    );
    for (const document of page.documents) {
      if (document.recordKey.startsWith(CHANNEL_RECORD_PREFIX))
        documents.set(document.recordKey, document.sourceHash);
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return [...documents].map(([recordKey, sourceHash]) => ({
    recordKey,
    sourceHash,
  }));
}

/** Reads channel records by key. A record missing any directory field, or
 * no longer cached, is left out. */
export async function readDirectoryChannels(
  host: Pick<CacheHost, 'readRecordsByKeys'>,
  keys: readonly string[],
  signal?: AbortSignal
): Promise<Map<string, DirectoryChannel>> {
  const channels = new Map<string, DirectoryChannel>();
  for (let offset = 0; offset < keys.length; offset += READ_BATCH_LIMIT) {
    signal?.throwIfAborted();
    const { records } = await readRecordsByKeys(
      host,
      CHANNEL_DIRECTORY_SELECTION,
      keys.slice(offset, offset + READ_BATCH_LIMIT)
    );
    for (const { recordKey, record } of records) {
      const fields = record as ChannelDirectoryFieldsFragment;
      if (fields.__typename === 'GraphqlSoupChannel')
        channels.set(recordKey, toDirectoryChannel(fields));
    }
  }
  return channels;
}

/** One cached channel record, read through the directory's fields. `channel`
 * is null while the record lacks one of them. */
type IndexEntry = { sourceHash: string; channel: DirectoryChannel | null };

/** What the index holds of one channel's record: the record, the search
 * hash of a record that lacks a directory field, or undefined for none. */
export type RecordVersion = DirectoryChannel | string | undefined;

/** Whether two versions are of the same record: the same fields, or the
 * same search hash while it lacks one. */
export function sameRecordVersion(a: RecordVersion, b: RecordVersion) {
  if (a === b) return true;
  return typeof a === 'object' && typeof b === 'object' && deepEqual(a, b);
}

/** What a reread of some records found: `stale` when the index holds
 * another storage generation and needs a full refresh first, `unchanged`
 * when every record read matched what the index held. */
export type ChannelDirectoryKeysRead =
  | { kind: 'stale' }
  | { kind: 'unchanged' }
  | { kind: 'read'; read: ChannelDirectoryRead };

/** What one refresh of the cached directory found. */
export type ChannelDirectoryRead = {
  /** Every complete channel record, the same object while it is unchanged. */
  channels: DirectoryChannel[];
  /** Ids of the records the search lists that lack a directory field. */
  incompleteIds: string[];
  /** Records read this time: new or changed since the last refresh. */
  reread: number;
};

/**
 * The cached channel directory, kept between refreshes so that each one
 * rereads only the records whose search document changed. A storage
 * generation change starts it over.
 */
export function createChannelDirectoryIndex(
  host: Pick<CacheHost, 'search' | 'readRecordsByKeys'>
) {
  let entries = new Map<string, IndexEntry>();
  let generation: string | undefined;
  // The lists `entries` gives, kept until an entry changes, so a refresh
  // that finds nothing new walks no entry to answer.
  let listed: Omit<ChannelDirectoryRead, 'reread'> | undefined;

  const snapshot = (reread: number): ChannelDirectoryRead => {
    if (!listed) {
      const channels: DirectoryChannel[] = [];
      const incompleteIds: string[] = [];
      for (const [recordKey, entry] of entries) {
        if (entry.channel) channels.push(entry.channel);
        else incompleteIds.push(recordKey.slice(CHANNEL_RECORD_PREFIX.length));
      }
      listed = { channels, incompleteIds };
    }
    return { ...listed, reread };
  };

  return {
    /** What the index holds of the channel's record now. */
    version(channelId: string): RecordVersion {
      const entry = entries.get(`${CHANNEL_RECORD_PREFIX}${channelId}`);
      if (!entry) return undefined;
      return entry.channel ?? `incomplete:${entry.sourceHash}`;
    },

    /** The channel's record, if the index holds it with every field. */
    record(channelId: string): DirectoryChannel | undefined {
      return (
        entries.get(`${CHANNEL_RECORD_PREFIX}${channelId}`)?.channel ??
        undefined
      );
    },

    async refresh(
      storageGeneration: string,
      signal?: AbortSignal
    ): Promise<ChannelDirectoryRead> {
      if (storageGeneration !== generation) {
        entries = new Map();
        listed = undefined;
        generation = storageGeneration;
      }
      const documents = await listCachedChannelDocuments(host, signal);
      const inSearch = new Set(documents.map(({ recordKey }) => recordKey));
      const changed = documents.filter(
        ({ recordKey, sourceHash }) =>
          entries.get(recordKey)?.sourceHash !== sourceHash
      );
      // A record whose sort time changed while the pages were read can be
      // missed by them; read it by key before dropping it.
      const unlisted = [...entries.keys()].filter((key) => !inSearch.has(key));
      // Every listed record as the index holds it: nothing to read or rebuild.
      if (changed.length === 0 && unlisted.length === 0) return snapshot(0);
      const read = await readDirectoryChannels(
        host,
        [...changed.map(({ recordKey }) => recordKey), ...unlisted],
        signal
      );
      signal?.throwIfAborted();

      const next = new Map<string, IndexEntry>();
      for (const { recordKey, sourceHash } of documents) {
        const previous = entries.get(recordKey);
        next.set(
          recordKey,
          previous?.sourceHash === sourceHash
            ? previous
            : { sourceHash, channel: read.get(recordKey) ?? null }
        );
      }
      for (const key of unlisted) {
        const channel = read.get(key);
        // An empty hash makes the next refresh read it again once listed.
        if (channel) next.set(key, { sourceHash: '', channel });
      }
      entries = next;
      listed = undefined;
      return snapshot(read.size);
    },

    /**
     * Rereads only these records, for the channels a by-id read just wrote,
     * without listing the rest. A record still missing a field keeps the
     * entry it had, and so does one whose fields match it, so a read that
     * changed nothing walks no other entry.
     */
    async readKeys(
      storageGeneration: string,
      recordKeys: readonly string[],
      signal?: AbortSignal
    ): Promise<ChannelDirectoryKeysRead> {
      if (storageGeneration !== generation) return { kind: 'stale' };
      const read = await readDirectoryChannels(host, recordKeys, signal);
      signal?.throwIfAborted();
      if (storageGeneration !== generation) return { kind: 'stale' };
      let changed = 0;
      for (const [recordKey, channel] of read) {
        if (deepEqual(entries.get(recordKey)?.channel, channel)) continue;
        // An empty hash makes the next refresh read it again.
        entries.set(recordKey, { sourceHash: '', channel });
        listed = undefined;
        changed += 1;
      }
      if (changed === 0) return { kind: 'unchanged' };
      return { kind: 'read', read: snapshot(read.size) };
    },
  };
}
