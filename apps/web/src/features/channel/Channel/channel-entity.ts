import type { ChannelEntity } from '@entity';
import { createChannelDetailQuery } from '@queries/channel/detail';
import { queryReadyGate } from '@queries/gate';
import { type Accessor, createMemo } from 'solid-js';

export function useChannelByIdQuery(
  channelId: Accessor<string | undefined>,
  enabled: Accessor<boolean>,
  options: { revalidateOnMount?: boolean } = {}
) {
  // Every activation needs a fresh complete unread edge for marking read.
  // Menu observers reuse that result; activation observers still revalidate.
  return createChannelDetailQuery(
    channelId,
    enabled,
    options.revalidateOnMount === false ? 'cache-first' : 'cache-and-network'
  );
}

/**
 * The open conversation as a soup entity, for surfaces that hold a channel id
 * and need the row behind it (its entity actions, say). Shares the by-id
 * query with any other reader of the same channel, so a host that already
 * resolves the conversation does not pay for a second request.
 */
export function useChannelEntity(
  channelId: Accessor<string | undefined>
): Accessor<ChannelEntity | undefined> {
  const query = useChannelByIdQuery(channelId, () => !!channelId(), {
    revalidateOnMount: false,
  });

  return createMemo<ChannelEntity | undefined>((previous) => {
    const id = channelId();
    if (!id) return undefined;
    // A pending read suspends, and a revalidation must not blank what it feeds.
    if (!queryReadyGate(query))
      return previous?.id === id ? previous : undefined;
    const entity = query.data.entities.find((entity) => entity.id === id);
    return entity?.type === 'channel' ? entity : undefined;
  });
}
