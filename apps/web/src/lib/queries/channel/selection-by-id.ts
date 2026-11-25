import type { ChannelEntity } from '@entity/types/entity';
import { ChannelDetailSoupDocument } from '@service-storage/graphql/generated/graphql';
import { fetchGraphqlSoup } from '@service-storage/graphql-soup';
import { buildGraphqlEntitySoupInput } from '../soup/graphql/entity-input';
import { mapApiSoupItemToEntity } from '../soup/transform-utils';

/** Read one channel with current membership and its complete unread edge. */
export async function fetchChannelSelectionById(
  channelId: string,
  signal?: AbortSignal
): Promise<ChannelEntity> {
  const input = buildGraphqlEntitySoupInput('CHANNEL', channelId);
  if (!input) throw new Error('Invalid channel selection');
  const page = await fetchGraphqlSoup(
    ChannelDetailSoupDocument,
    { input },
    {
      requestPolicy: 'network-only',
      allowOfflineFallback: false,
      ...(signal && { signal }),
    }
  );
  const item = page.items.find(
    (item) => item.tag === 'channel' && item.data.channel.id === channelId
  );
  if (!item || item.tag !== 'channel')
    throw new Error('Conversation is unavailable');
  const channel = mapApiSoupItemToEntity(item);
  if (channel.type !== 'channel') throw new Error('Invalid channel selection');
  return channel;
}
