import {
  type CacheHost,
  readRecordsByKeys,
  type SearchDocumentWire,
  selectRecords,
} from '@graphql-cache/index';
import {
  type GraphqlChannelQuickAccessFieldsFragment,
  GraphqlChannelQuickAccessFieldsFragmentDoc,
} from '@service-storage/graphql/generated/graphql';
import { match } from 'ts-pattern';

/** Minimal cached GraphQL channel fields used by Quick Access. */
export type CachedGraphqlChannel = {
  id: string;
  name: string;
  ownerId: string;
  channelType: 'direct_message' | 'private' | 'public' | 'team';
  participantIds: string[];
  createdAt: string;
  updatedAt: string;
  viewedAt?: string;
  interactedAt?: string;
};

function normalizeChannelType(
  channelType: string
): CachedGraphqlChannel['channelType'] {
  return match<string, CachedGraphqlChannel['channelType']>(
    channelType.toLowerCase()
  )
    .with('direct_message', () => 'direct_message')
    .with('private', () => 'private')
    .with('team', () => 'team')
    .otherwise(() => 'public');
}

/** Materializes supplied cached GraphQL channel search hits. */
export async function materializeCachedGraphqlChannels(
  cacheHost: Pick<CacheHost, 'readRecordsByKeys'>,
  documents: SearchDocumentWire[]
): Promise<CachedGraphqlChannel[]> {
  const channelDocuments = documents.filter((document) =>
    document.recordKey.startsWith('GraphqlSoupChannel:')
  );
  if (channelDocuments.length === 0) return [];

  const records = await readRecordsByKeys(
    cacheHost,
    selectRecords(GraphqlChannelQuickAccessFieldsFragmentDoc),
    channelDocuments.map((document) => document.recordKey)
  );

  return records.records.flatMap(({ recordKey, record }) => {
    const channel = record as GraphqlChannelQuickAccessFieldsFragment;
    if (channel.__typename !== 'GraphqlSoupChannel') return [];
    const separator = recordKey.indexOf(':');
    if (separator < 0) return [];

    return [
      {
        id: recordKey.slice(separator + 1),
        name: channel.name ?? '',
        ownerId: channel.ownerId,
        channelType: normalizeChannelType(channel.channelType),
        participantIds: channel.participants.map(({ userId }) => userId),
        createdAt: channel.createdAt,
        updatedAt: channel.updatedAt,
        viewedAt: channel.viewedAt ?? undefined,
        interactedAt: channel.interactedAt ?? undefined,
      },
    ];
  });
}

/** Reads the bounded recent channel list used for empty Quick Access menus. */
export async function readCachedGraphqlChannels(
  cacheHost: Pick<CacheHost, 'search' | 'readRecordsByKeys'>,
  limit = 50
): Promise<CachedGraphqlChannel[]> {
  const page = await cacheHost.search({
    profile: 'quick-access-v1',
    buckets: ['channel', 'dm'],
    query: '',
    limit,
  });
  return materializeCachedGraphqlChannels(cacheHost, page.documents);
}
