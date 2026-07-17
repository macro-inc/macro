import {
  compileToAst,
  defineQueryFilters,
  NIL_UUID,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import type { ChannelEntity } from '@entity';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { createMemo } from 'solid-js';

const CHANNEL_LOOKUP_LIMIT = 250;
const CHANNEL_LOOKUP_STALE_MS = 5 * 60 * 1000;

/**
 * A best-effort channel-id → channel lookup for labeling timeline rows
 * ("… in #general"). Loads the user's most recently active channels in one
 * page; rows whose channel falls outside it just render without a location.
 */
export function useChannelLookup(): (
  channelId: string
) => ChannelEntity | undefined {
  const query = useSoupAstItemsQuery(
    () => ({
      params: { limit: CHANNEL_LOOKUP_LIMIT, sort_method: 'updated_at' },
      body: compileToAst(
        queryStateFrom(
          defineQueryFilters({ exclude: { channelId: [NIL_UUID] } })
        )
      ),
    }),
    () => ({ staleTime: CHANNEL_LOOKUP_STALE_MS })
  );

  const byId = createMemo(() => {
    const map = new Map<string, ChannelEntity>();
    for (const entity of query.data?.entities ?? []) {
      if (entity.type === 'channel') map.set(entity.id, entity);
    }
    return map;
  });

  return (channelId) => byId().get(channelId);
}
