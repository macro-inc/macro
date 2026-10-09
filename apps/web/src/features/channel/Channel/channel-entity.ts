import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import type { ChannelEntity } from '@entity';
import { queryReadyGate } from '@queries/gate';
import {
  type SoupAstItemsQueryArgs,
  useSoupAstItemsQuery,
} from '@queries/soup/items';
import { type Accessor, createMemo } from 'solid-js';

function channelByIdQueryArgs(channelId: string): SoupAstItemsQueryArgs {
  return {
    params: { limit: 1, sort_method: 'created_at' },
    body: compileToAst(
      queryStateFrom(
        defineQueryFilters({
          include: { channelId: [channelId] },
        })
      )
    ),
  };
}

export function useChannelByIdQuery(
  channelId: Accessor<string | undefined>,
  enabled: Accessor<boolean>
) {
  return useSoupAstItemsQuery(
    () => channelByIdQueryArgs(channelId() ?? ''),
    // Every activation needs a fresh complete edge for thread scoping and marking
    // read. GraphQL revalidates on activation; keep the REST fallback stale too.
    () => ({ enabled: enabled(), staleTime: 0 })
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
  const query = useChannelByIdQuery(channelId, () => channelId() !== undefined);

  return createMemo<ChannelEntity | undefined>((previous) => {
    const id = channelId();
    if (!id) return undefined;
    // A pending read suspends, and a revalidation must not blank what it feeds.
    if (!queryReadyGate(query))
      return previous?.id === id ? previous : undefined;
    return query.data.entities.find(
      (entity): entity is ChannelEntity =>
        entity.type === 'channel' && entity.id === id
    );
  });
}
