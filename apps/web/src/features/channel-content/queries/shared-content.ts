import { compileToAst } from '@app/features/next-soup/filters/filter-store';
import { throwOnErr } from '@core/util/result';
import type { EntityData } from '@entity';
import { channelKeys } from '@queries/channel/keys';
import {
  isDisplayableSoupItem,
  mapApiSoupItemToEntity,
} from '@queries/soup/transform-utils';
import {
  type ApiChannelAttachment,
  storageServiceClient,
} from '@service-storage/client';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { channelContentScope } from './content-scope';

/** Resolve the complete reference index before applying list filters. */
export function useChannelSharedContent(
  channelId: Accessor<string>,
  type: 'dss' | 'static' = 'dss'
) {
  return useQuery(() => ({
    queryKey: [
      ...channelKeys.attachments(channelId(), type).queryKey,
      'shared-content',
    ],
    queryFn: async ({ signal }) => {
      const items: ApiChannelAttachment[] = [];
      let cursor: string | undefined;
      do {
        const page = await throwOnErr(() =>
          storageServiceClient.getChannelAttachments({
            channel_id: channelId(),
            attachment_type: type,
            limit: 100,
            cursor: cursor ?? null,
            signal,
          })
        );
        items.push(...page.items);
        cursor = page.next_cursor ?? undefined;
      } while (cursor && !signal.aborted);
      return items;
    },
    staleTime: 30_000,
  }));
}

/** Walk references in sharing order; stop as soon as five visible matches resolve. */
export function useChannelRecentContent(
  channelId: Accessor<string>,
  kind: 'files' | 'tasks'
) {
  const references = useChannelSharedContent(channelId);
  const query = useQuery(() => ({
    queryKey: [
      ...channelKeys.attachments(channelId(), 'dss').queryKey,
      'recent',
      kind,
      references.isSuccess ? references.data : [],
    ],
    enabled: references.isSuccess,
    queryFn: async ({ signal }) => {
      const shared = references.isSuccess ? references.data : [];
      const unique = [
        ...new Map(
          [...shared].reverse().map((item) => [item.entity_id, item])
        ).values(),
      ].sort((a, b) => b.created_at.localeCompare(a.created_at));
      const entities: EntityData[] = [];
      for (
        let offset = 0;
        offset < unique.length && entities.length < 5;
        offset += 50
      ) {
        const batch = unique.slice(offset, offset + 50);
        const response = await throwOnErr(() =>
          storageServiceClient.getSoupAstItems({
            params: {},
            body: {
              ...compileToAst(channelContentScope(kind, channelId(), batch)),
              limit: 100,
            },
            signal,
          })
        );
        const mapped = response.items
          .filter(isDisplayableSoupItem)
          .map(mapApiSoupItemToEntity);
        const rank = new Map(
          batch.map((item, index) => [item.entity_id, index])
        );
        mapped.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
        entities.push(...mapped);
      }
      return entities.slice(0, 5);
    },
    staleTime: 30_000,
  }));
  return { query, references };
}
