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

/** What one refresh of the cached directory found. */
export type ChannelDirectoryRead = {
  /** Every complete channel record, the same object while it is unchanged. */
  channels: DirectoryChannel[];
  /** Records the search lists that lack a directory field. */
  incomplete: number;
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

  return {
    async refresh(
      storageGeneration: string,
      signal?: AbortSignal
    ): Promise<ChannelDirectoryRead> {
      if (storageGeneration !== generation) {
        entries = new Map();
        generation = storageGeneration;
      }
      const documents = await listCachedChannelDocuments(host, signal);
      const listed = new Set(documents.map(({ recordKey }) => recordKey));
      const changed = documents.filter(
        ({ recordKey, sourceHash }) =>
          entries.get(recordKey)?.sourceHash !== sourceHash
      );
      // A record whose sort time changed while the pages were read can be
      // missed by them; read it by key before dropping it.
      const unlisted = [...entries.keys()].filter((key) => !listed.has(key));
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

      const channels: DirectoryChannel[] = [];
      let incomplete = 0;
      for (const entry of entries.values()) {
        if (entry.channel) channels.push(entry.channel);
        else incomplete += 1;
      }
      return { channels, incomplete, reread: read.size };
    },
  };
}
