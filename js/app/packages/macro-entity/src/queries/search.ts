import { useChannelsContext } from '@core/component/ChannelsProvider';
import { ENABLE_SEARCH_SERVICE } from '@core/constant/featureFlags';
import { isErr } from '@core/util/maybeResult';
import type { ChannelType } from '@service-comms/generated/models';
import { type PaginatedSearchArgs, searchClient } from '@service-search/client';
import type { UnifiedSearchResponseItem } from '@service-search/generated/models';
import { useInfiniteQuery } from '@tanstack/solid-query';
import { type Accessor, createMemo } from 'solid-js';
import type { EntityData } from '../types/entity';
import type { EntityInfiniteQuery } from './entity';
import { queryKeys } from './key';

const useMapSearchResponseItem = () => {
  const channelsContext = useChannelsContext();
  const channels = () => channelsContext.channels();

  return (result: UnifiedSearchResponseItem): EntityData | undefined => {
    switch (result.type) {
      case 'document':
        return {
          type: 'document',
          id: result.document_id,
          name: result.document_name,
          ownerId: result.owner_id,
          createdAt: result.created_at,
          updatedAt: result.updated_at,
          fileType: result.file_type || undefined,
          projectId: result.project_id ?? undefined,
        };

      case 'email':
        const emailResult = result.email_message_search_results.at(0);
        if (!emailResult) {
          console.error('Email result not found', result);
          return;
        }
        return {
          type: 'email',
          id: result.thread_id,
          name: emailResult.subject ?? '',
          ownerId: emailResult.sender,
          createdAt: emailResult.sent_at ?? emailResult.updated_at,
          updatedAt: emailResult.sent_at ?? emailResult.updated_at,
          viewedAt: emailResult.updated_at,
          isRead: !emailResult.labels.includes('UNREAD'),
          isImportant: emailResult.labels.includes('IMPORTANT'),
          done: !emailResult.labels.includes('INBOX'),
          senderName: emailResult.sender,
        };

      case 'chat':
        return {
          type: 'chat',
          id: result.chat_id,
          name: result.name,
          ownerId: result.user_id,
          createdAt: result.created_at,
          updatedAt: result.updated_at,
          projectId: result.project_id ?? undefined,
        };

      case 'channel':
        // sort in ascending order by created at and take the last result
        const channelResult = result.channel_message_search_results
          .toSorted((a, b) => a.created_at - b.created_at)
          .at(-1);

        return {
          type: 'channel',
          // TODO: distinguish channel name match from channel message match
          id: result.channel_id,
          name:
            result.name ??
            // TODO: we will need to hydrate dynamic name from the backend
            channels().find((c) => c.id === result.channel_id)?.name ??
            '',
          ownerId: result.owner_id ?? '',
          createdAt: result.created_at,
          updatedAt: result.updated_at,
          channelType: result.channel_type as ChannelType,
          interactedAt: result.interacted_at ?? undefined,
          latestMessage: channelResult
            ? {
                content: channelResult.content.at(0) ?? '',
                senderId: channelResult.sender_id,
                createdAt: channelResult.created_at,
              }
            : undefined,
        };

      case 'project':
        return {
          type: 'project',
          id: result.id,
          name: result.name,
          ownerId: result.owner_id,
          createdAt: result.created_at,
          updatedAt: result.updated_at,
          parentId: result.parent_project_id ?? undefined,
        };
    }
  };
};

const fetchPaginatedSearchResults = async (args: PaginatedSearchArgs) => {
  const res = await searchClient.search(args);
  if (isErr(res)) throw res[0];
  const [, data] = res;
  return data;
};

export function createUnifiedSearchInfiniteQuery(
  args: Accessor<PaginatedSearchArgs>,
  options?: {
    disabled?: Accessor<boolean>;
  }
): EntityInfiniteQuery {
  const params = createMemo(() => args());
  const pageParams = createMemo(() => params().params);
  const request = createMemo(() => params().request);
  const terms = createMemo(() => {
    const query = request().query;
    const hasQuery = query && query.length > 0;
    const terms = request().terms;
    const hasTerms = terms && terms.length > 0;
    if (hasTerms && hasQuery) {
      console.error('Cannot have both query and terms');
      return [];
    }
    if (hasTerms) {
      return terms;
    }
    if (hasQuery) {
      return [query];
    }
    return [];
  });
  const validSearchTerms = createMemo(() => {
    return terms().length > 0 && terms().every((term) => term.length >= 3);
  });
  const validSearchFilters = createMemo(() => {
    const senders = params().request.filters?.email?.senders;
    if (senders && senders.length > 0) return true;
    return false;
  });
  const enabled = createMemo(
    () =>
      ENABLE_SEARCH_SERVICE &&
      !options?.disabled?.() &&
      (validSearchTerms() || validSearchFilters())
  );
  const mapSearchResponseItem = useMapSearchResponseItem();

  const query = useInfiniteQuery(() => ({
    queryKey: queryKeys.search({
      infinite: true,
      ...params(),
    }),
    queryFn: (ctx) =>
      fetchPaginatedSearchResults({
        params: ctx.pageParam,
        request: request(),
      }),
    initialPageParam: pageParams(),
    getNextPageParam: (lastPage, _allPages, lastPageParam, _allPageParams) => {
      if (lastPage.results.length === 0) return;
      return {
        ...pageParams(),
        page: lastPageParam.page + 1,
      };
    },
    select: (data) =>
      data.pages.flatMap((page) =>
        page.results
          .map(mapSearchResponseItem)
          .filter((entity): entity is EntityData => !!entity)
      ),
    enabled: enabled(),
  }));

  return query;
}
