import { useChannelsContext } from '@core/component/ChannelsProvider';
import { ENABLE_SEARCH_SERVICE } from '@core/constant/featureFlags';
import { isErr } from '@core/util/maybeResult';
import {
  extractSearchSnippet,
  extractSearchTerms,
  mergeAdjacentMacroEmTags,
} from '@core/util/searchHighlight';
import type { ChannelType } from '@service-comms/generated/models';
import { type PaginatedSearchArgs, searchClient } from '@service-search/client';
import type {
  ChannelSearchResult,
  ChatMessageSearchResult,
  DocumentSearchResult,
  EmailSearchResult,
  ProjectSearchResult,
  UnifiedSearchResponseItem,
} from '@service-search/generated/models';
import { useHistory } from '@service-storage/history';
import { useInfiniteQuery } from '@tanstack/solid-query';
import { type Accessor, createMemo } from 'solid-js';
import type { EntityData } from '../types/entity';
import type {
  FileTypeWithLocation,
  SearchLocation,
  WithSearch,
} from '../types/search';
import type { EntityInfiniteQuery } from './entity';
import { queryKeys } from './key';

type Entity = WithSearch<EntityData>;

type InnerSearchResult =
  | DocumentSearchResult
  | EmailSearchResult
  | ChatMessageSearchResult
  | ChannelSearchResult
  | ProjectSearchResult;

const getDocumentContentHitData = (
  innerResults: DocumentSearchResult[],
  fileType: FileTypeWithLocation,
  searchQuery: string
) => {
  const contentHitData = innerResults.flatMap((r) => {
    const contents = r.highlight.content ?? [];

    return contents.map((content) => {
      const mergedContent = mergeAdjacentMacroEmTags(content);
      let location: SearchLocation | undefined;
      switch (fileType) {
        case 'md':
          location = { type: 'md' as const, nodeId: r.node_id };
          break;
        case 'pdf':
          try {
            const searchPage = parseInt(r.node_id);
            location = {
              type: 'pdf' as const,
              searchPage,
              searchSnippet: extractSearchSnippet(mergedContent),
              searchRawQuery: searchQuery,
              highlightTerms: extractSearchTerms(mergedContent),
            };
          } catch (_e) {
            console.error('Cannot parse pdf serach info', r);
            location = undefined;
          }
          break;
      }

      return {
        type: undefined,
        content: mergedContent,
        location,
      };
    });
  });

  const nameHighlight = innerResults.at(0)?.highlight.name ?? null;

  return {
    nameHighlight: nameHighlight
      ? mergeAdjacentMacroEmTags(nameHighlight)
      : null,
    contentHitData: contentHitData.length > 0 ? contentHitData : null,
    source: 'service' as const,
  };
};

const getChannelContentHitData = (innerResults: ChannelSearchResult[]) => {
  const contentHitData = innerResults.flatMap((r) => {
    const contents = r.highlight.content ?? [];

    return contents.map((content) => ({
      type: 'channel-message' as const,
      id: r.message_id,
      content: mergeAdjacentMacroEmTags(content),
      senderId: r.sender_id,
      sentAt: r.created_at,
      location: undefined,
    }));
  });

  return {
    nameHighlight: null,
    contentHitData: contentHitData.length > 0 ? contentHitData : null,
    source: 'service' as const,
  };
};

const getContentHitData = (innerResults: InnerSearchResult[]) => {
  const contentHitData = innerResults.flatMap((r) => {
    const contents = r.highlight.content ?? [];

    return contents.map((content) => ({
      type: undefined,
      content: mergeAdjacentMacroEmTags(content),
      location: undefined,
    }));
  });

  const nameHighlight = innerResults.at(0)?.highlight.name ?? null;

  return {
    nameHighlight: nameHighlight
      ? mergeAdjacentMacroEmTags(nameHighlight)
      : null,
    contentHitData: contentHitData.length > 0 ? contentHitData : null,
    source: 'service' as const,
  };
};

const useMapSearchResponseItem = () => {
  const channelsContext = useChannelsContext();
  const channels = () => channelsContext.channels();

  const history = useHistory();

  return (
    result: UnifiedSearchResponseItem,
    searchQuery: string
  ): Entity | undefined => {
    switch (result.type) {
      case 'document': {
        if (!result.metadata || result.metadata.deleted_at) return;
        const searchFileType =
          result.file_type === 'docx' ? 'pdf' : result.file_type;
        const search = ['md', 'pdf'].includes(searchFileType)
          ? getDocumentContentHitData(
              result.document_search_results,
              searchFileType as FileTypeWithLocation,
              searchQuery
            )
          : getContentHitData(result.document_search_results);
        return {
          type: 'document',
          id: result.document_id,
          name: result.document_name,
          ownerId: result.owner_id,
          createdAt: result.metadata?.created_at,
          updatedAt: result.metadata?.updated_at,
          fileType: result.file_type || undefined,
          projectId: result.metadata?.project_id ?? undefined,
          search,
        };
      }
      case 'email': {
        const emailResult = result.email_message_search_results.at(0);
        // TODO: distinguish email message result from thread result
        if (!emailResult) {
          console.error('Email result not found', result);
          return;
        }
        const search = getContentHitData(result.email_message_search_results);
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
          search,
        };
      }
      case 'chat': {
        if (!result.metadata || result.metadata.deleted_at) return;
        const search = getContentHitData(result.chat_search_results);
        let name = result.name;
        if (!name || name === 'New Chat') {
          const chat = history().find((item) => item.id === result.chat_id);
          if (chat) {
            name = chat.name;
          }
        }
        return {
          type: 'chat',
          id: result.chat_id,
          name,
          ownerId: result.user_id,
          createdAt: result.metadata?.created_at,
          updatedAt: result.metadata?.updated_at,
          projectId: result.metadata?.project_id ?? undefined,
          search,
        };
      }
      case 'channel': {
        const channelWithLatest = channels().find(
          (c) => c.id === result.channel_id
        );

        const search = getChannelContentHitData(
          result.channel_message_search_results
        );

        return {
          type: 'channel',
          id: result.channel_id,
          name: channelWithLatest?.name ?? '',
          ownerId: result.owner_id ?? '',
          createdAt: result.metadata?.created_at,
          updatedAt: result.metadata?.updated_at,
          channelType: result.channel_type as ChannelType,
          interactedAt: result.metadata?.interacted_at ?? undefined,
          latestMessage: undefined,
          search,
        };
      }

      case 'project': {
        if (!result.metadata || result.metadata.deleted_at) return;
        const search = getContentHitData(result.project_search_results);
        return {
          type: 'project',
          id: result.id,
          name: result.name,
          ownerId: result.owner_id,
          createdAt: result.created_at,
          updatedAt: result.updated_at,
          parentId: result.metadata?.parent_project_id ?? undefined,
          search,
        };
      }
    }
  };
};

const fetchPaginatedSearchResults = async (
  args: PaginatedSearchArgs,
  signal?: AbortSignal
) => {
  const res = await searchClient.search(args, { signal });
  if (isErr(res)) throw res[0];
  const [, data] = res;
  return data;
};

export function createUnifiedSearchInfiniteQuery(
  args: Accessor<PaginatedSearchArgs>,
  options?: {
    disabled?: Accessor<boolean>;
  }
): EntityInfiniteQuery<Entity> {
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
      fetchPaginatedSearchResults(
        {
          params: ctx.pageParam,
          request: request(),
        },
        ctx.signal
      ),
    initialPageParam: pageParams(),
    getNextPageParam: (lastPage, _allPages, lastPageParam, _allPageParams) => {
      if (lastPage.results.length === 0) return;
      return {
        ...pageParams(),
        page: lastPageParam.page + 1,
      };
    },
    select: (data) => {
      const searchQuery = terms()[0];
      return data.pages.flatMap((page) =>
        page.results
          .map((result) => mapSearchResponseItem(result, searchQuery))
          .filter((entity): entity is Entity => !!entity)
      );
    },
    enabled: enabled(),
  }));

  return query;
}
