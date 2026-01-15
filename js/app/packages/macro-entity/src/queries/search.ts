import { useChannelsContext } from '@core/context/channels';
import { blockNameToDefaultFile } from '@core/constant/allBlocks';
import { ENABLE_SEARCH_SERVICE } from '@core/constant/featureFlags';
import { emailToId } from '@core/user';
import { isErr } from '@core/util/maybeResult';
import {
  extractSearchSnippet,
  extractSearchTerms,
  mergeAdjacentMacroEmTags,
  truncateSearchMatch,
} from '@core/util/searchHighlight';
import type { ChannelType } from '@service-comms/generated/models';
import { type SearchArgs, searchClient } from '@service-search/client';
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
import type { ContentHitData, SearchData, WithSearch } from '../types/search';
import type { EntityInfiniteQuery } from './entity';
import { queryKeys } from './key';

const SEARCH_MATCH_LENGTH = 60;

type InnerSearchResult =
  | DocumentSearchResult
  | EmailSearchResult
  | ChatMessageSearchResult
  | ChannelSearchResult
  | ProjectSearchResult;

type TypedInnerSearchResult =
  | { results: InnerSearchResult[]; type?: undefined }
  | { results: DocumentSearchResult[]; type: 'pdf'; searchQuery: string }
  | { results: DocumentSearchResult[]; type: 'md' }
  | { results: ChannelSearchResult[]; type: 'channel' }
  | { results: EmailSearchResult[]; type: 'email' };

export const isSearchEntity = <T extends EntityData>(
  entity: T
): entity is WithSearch<T> => 'search' in entity;

const getSearchData = (data: TypedInnerSearchResult): SearchData => {
  let contentHitData: ContentHitData[] = [];

  switch (data.type) {
    case 'channel': {
      contentHitData = data.results.flatMap((r) => {
        const isContentHit = !!r.message_id;
        if (!isContentHit) return [];

        const contents = r.highlight.content ?? [];
        return contents.map((content) => ({
          type: 'channel' as const,
          id: r.message_id!,
          content: truncateSearchMatch(
            mergeAdjacentMacroEmTags(content),
            SEARCH_MATCH_LENGTH
          ),
          senderId: r.sender_id!,
          sentAt: r.created_at!,
          location: {
            type: 'channel' as const,
            threadId: r.thread_id ?? undefined,
            messageId: r.message_id!,
          },
        }));
      });
      break;
    }
    case 'pdf': {
      contentHitData = data.results.flatMap((r) => {
        const contents = r.highlight.content ?? [];
        return contents.map((content) => {
          const mergedContent = mergeAdjacentMacroEmTags(content);
          return {
            type: 'pdf' as const,
            content: truncateSearchMatch(
              mergeAdjacentMacroEmTags(content),
              SEARCH_MATCH_LENGTH
            ),
            location: {
              type: 'pdf' as const,
              searchPage: Number(r.node_id),
              searchSnippet: extractSearchSnippet(mergedContent),
              searchRawQuery: data.searchQuery,
              highlightTerms: extractSearchTerms(mergedContent),
            },
          };
        });
      });
      break;
    }
    case 'md': {
      contentHitData = data.results.flatMap((r) => {
        const isContentHit = !!r.node_id;
        if (!isContentHit) return [];

        const contents = r.highlight.content ?? [];
        return contents.map((content) => ({
          type: 'md' as const,
          content: truncateSearchMatch(
            mergeAdjacentMacroEmTags(content),
            SEARCH_MATCH_LENGTH
          ),
          location: { type: 'md' as const, nodeId: r.node_id! },
        }));
      });
      break;
    }
    case 'email': {
      contentHitData = data.results.flatMap((r) => {
        const contents = r.highlight.content ?? [];
        return contents.map((content) => ({
          type: 'email' as const,
          content: truncateSearchMatch(
            mergeAdjacentMacroEmTags(content),
            SEARCH_MATCH_LENGTH
          ),
          sender: r.pretty_sender!,
          senderId: emailToId(r.sender),
          sentAt: r.sent_at!,
          location: {
            type: 'email' as const,
            messageId: r.message_id!,
          },
        }));
      });
      break;
    }
    default: {
      contentHitData = data.results.flatMap((r) => {
        const contents = r.highlight.content ?? [];
        return contents.map((content) => ({
          content: truncateSearchMatch(
            mergeAdjacentMacroEmTags(content),
            SEARCH_MATCH_LENGTH
          ),
          location: undefined,
        }));
      });
    }
  }

  const nameHighlight = data.results.at(0)?.highlight.name ?? null;

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
  const channels = channelsContext.channels;

  const history = useHistory();

  return (
    result: UnifiedSearchResponseItem,
    searchQuery: string
  ): WithSearch<EntityData> | undefined => {
    switch (result.type) {
      case 'document': {
        if (!result.metadata || result.metadata.deleted_at) return;
        const searchFileType =
          result.file_type === 'docx' ? 'pdf' : result.file_type;
        let search: SearchData;
        if (searchFileType === 'md') {
          search = getSearchData({
            results: result.document_search_results,
            type: 'md',
          });
        } else if (searchFileType === 'pdf') {
          search = getSearchData({
            results: result.document_search_results,
            type: 'pdf',
            searchQuery,
          });
        } else {
          search = getSearchData({
            results: result.document_search_results,
          });
        }
        return {
          type: 'document',
          subType: result.sub_type === 'task' ? { type: 'task' } : null,
          id: result.document_id,
          name: result.name || blockNameToDefaultFile(result.file_type),
          ownerId: result.owner_id,
          createdAt: result.metadata?.created_at,
          updatedAt: result.metadata?.updated_at,
          fileType: result.file_type || undefined,
          projectId: result.metadata?.project_id ?? undefined,
          search,
        };
      }
      case 'email': {
        const messageHits = result.email_message_search_results.filter(
          (m) => m.message_id
        );
        // NOTE: guaranteed to be empty or singleton array
        const threadHits = result.email_message_search_results.filter(
          (m) => !m.message_id
        );

        const singleMessage = messageHits.length === 1;

        const search = getSearchData({
          results: result.email_message_search_results,
          type: 'email',
        });

        const name = result.name ?? blockNameToDefaultFile('email');

        // TODO: display sender for each message in the content hit list
        const combinedSenders =
          [...new Set(messageHits.map((m) => m.pretty_sender))].join(', ') ||
          threadHits.at(0)?.pretty_sender;

        // TODO: we probably want to get the actual latest message info on the full thread
        const messagesSentAt = messageHits
          .map((m) => m.sent_at)
          .filter((m) => m != null);
        const latestMessageSentAt =
          messagesSentAt.length > 0 ? Math.max(...messagesSentAt) : null;

        return {
          type: 'email',
          id: result.thread_id,
          name,
          ownerId: result.owner_id,
          createdAt: latestMessageSentAt ?? result.created_at,
          updatedAt: latestMessageSentAt ?? result.updated_at,
          viewedAt: result.viewed_at ?? undefined,
          isRead: singleMessage
            ? !messageHits[0].labels.includes('UNREAD')
            : false,
          isImportant: singleMessage
            ? messageHits[0].labels.includes('IMPORTANT')
            : false,
          isDraft: singleMessage
            ? messageHits[0].labels.includes('DRAFT')
            : false,
          done: singleMessage
            ? !messageHits[0].labels.includes('INBOX')
            : false,
          senderName: combinedSenders,
          search,
        };
      }
      case 'chat': {
        if (!result.metadata || result.metadata.deleted_at) return;
        const search = getSearchData({
          results: result.chat_search_results,
        });
        let name = result.name;
        if (!name || name === blockNameToDefaultFile('chat')) {
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

        const search = getSearchData({
          type: 'channel',
          results: result.channel_message_search_results,
        });

        return {
          type: 'channel',
          id: result.channel_id,
          name: channelWithLatest?.name ?? blockNameToDefaultFile('channel'),
          ownerId: result.owner_id ?? '',
          createdAt: result.metadata?.created_at,
          updatedAt: result.metadata?.updated_at,
          channelType: result.channel_type as ChannelType,
          interactedAt: result.metadata?.interacted_at ?? undefined,
          participantIds: channelWithLatest?.participants?.map(
            (p) => p.user_id
          ),
          search,
        };
      }

      case 'project': {
        if (!result.metadata || result.metadata.deleted_at) return;
        const search = getSearchData({
          results: result.project_search_results,
        });

        return {
          type: 'project',
          id: result.id,
          name: result.name,
          ownerId: result.owner_id,
          createdAt: result.created_at,
          updatedAt: result.updated_at,
          projectId: result.metadata?.parent_project_id ?? undefined,
          search,
        };
      }
    }
  };
};

const fetchSearchResults = async (args: SearchArgs, signal?: AbortSignal) => {
  const res = await searchClient.search(args, { signal });
  if (isErr(res)) throw res[0];
  const [, data] = res;
  return data;
};

export function createUnifiedSearchInfiniteQuery(
  args: Accessor<SearchArgs>,
  options?: {
    disabled?: Accessor<boolean>;
  }
): EntityInfiniteQuery<WithSearch<EntityData>> {
  const params = createMemo(() => args());
  const pageSize = createMemo(() => params().params.page_size);
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
      fetchSearchResults(
        {
          params: ctx.pageParam,
          request: request(),
        },
        ctx.signal
      ),
    initialPageParam: {
      cursor: null as string | null,
      page_size: pageSize(),
    },
    getNextPageParam: (lastPage) => {
      if (!lastPage.next_cursor) return;
      return {
        cursor: lastPage.next_cursor as string | null,
        page_size: pageSize(),
      };
    },
    select: (data) => {
      const searchQuery = terms()[0];
      return data.pages.flatMap((page) =>
        page.results
          .map((result) => mapSearchResponseItem(result, searchQuery))
          .filter((entity): entity is WithSearch<EntityData> => !!entity)
      );
    },
    enabled: enabled(),
  }));

  return query;
}
