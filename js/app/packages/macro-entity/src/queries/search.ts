import { useChannelsContext } from '@core/component/ChannelsProvider';
import { ENABLE_SEARCH_SERVICE } from '@core/constant/featureFlags';
import { isErr } from '@core/util/maybeResult';
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

const MAX_SEARCH_TERM_LENGTH = 1000;

/**
 * Extracts the full snippet from highlighted content by removing macro_em tags.
 * This provides context for the search result.
 */
function extractSearchSnippet(highlightedContent: string): string {
  return highlightedContent.replace(/<\/?macro_em>/g, '');

  const firstMatch = highlightedContent.indexOf('<macro_em>');
  const lastMatch = highlightedContent.lastIndexOf('</macro_em>');

  if (firstMatch === -1 || lastMatch === -1) {
    return '';
  }

  const substring = highlightedContent.substring(
    firstMatch,
    lastMatch + '</macro_em>'.length
  );

  const plainText = substring.replace(/<\/?macro_em>/g, '');
  return plainText.substring(0, MAX_SEARCH_TERM_LENGTH);
}

/**
 * Extracts the search term from highlighted content by finding text from the first
 * to last <macro_em> tag, removing all macro_em tags to create plain text.
 * Truncates to MAX_SEARCH_TERM_LENGTH characters.
 */
function extractSearchTermFromHighlight(
  highlightedContent: string,
  searchQuery?: string
): string {
  const firstMatch = highlightedContent.indexOf('<macro_em>');
  const lastMatch = highlightedContent.lastIndexOf('</macro_em>');

  if (firstMatch === -1 || lastMatch === -1) {
    return '';
  }

  const substring = highlightedContent.substring(
    firstMatch,
    lastMatch + '</macro_em>'.length
  );

  // Group adjacent macro_em tags into single tags
  let grouped = substring.replace(/<\/macro_em>\s*<macro_em>/g, '');

  // Extract all content from macro_em tags
  const macroEmRegex = /<macro_em>(.*?)<\/macro_em>/gs;
  const matches = Array.from(grouped.matchAll(macroEmRegex));

  if (matches.length === 0) {
    return '';
  }

  // If search query provided, check if any macro_em content matches it
  if (searchQuery) {
    const normalizedQuery = searchQuery.toLowerCase().trim();
    for (const match of matches) {
      const content = match[1].trim().toLowerCase();
      if (content === normalizedQuery) {
        return searchQuery.substring(0, MAX_SEARCH_TERM_LENGTH);
      }
    }
  }

  // Otherwise, use the first macro_em tag content
  const firstContent = matches[0][1].trim();
  return firstContent.substring(0, MAX_SEARCH_TERM_LENGTH);
}

const getLocationHighlights = (
  innerResults: DocumentSearchResult[],
  fileType: FileTypeWithLocation,
  searchQuery?: string
) => {
  const contentHighlights = innerResults.flatMap((r) => {
    const contents = r.highlight.content ?? [];

    return contents.map((content) => {
      let location: SearchLocation | undefined;
      switch (fileType) {
        case 'md':
          location = { type: 'md' as const, nodeId: r.node_id };
          break;
        case 'pdf':
          try {
            const searchPage = parseInt(r.node_id);
            const searchTerm = extractSearchTermFromHighlight(
              content,
              searchQuery
            );
            const searchSnippet = extractSearchSnippet(content);
            location = {
              type: 'pdf' as const,
              searchPage,
              searchMatchNumOnPage: 0,
              searchTerm,
              searchSnippet,
              highlightedContent: content,
            };
          } catch (_e) {
            console.error('Cannot parse pdf page number', r.node_id);
            location = undefined;
          }
          break;
      }

      return {
        content,
        location,
      };
    });
  });

  return {
    nameHighlight: innerResults.at(0)?.highlight.name ?? null,
    contentHighlights: contentHighlights.length > 0 ? contentHighlights : null,
    source: 'service' as const,
  };
};

const getHighlights = (innerResults: InnerSearchResult[]) => {
  const contentHighlights = innerResults.flatMap((r) => {
    const contents = r.highlight.content ?? [];

    return contents.map((content) => ({
      content,
      location: undefined,
    }));
  });

  return {
    nameHighlight: innerResults.at(0)?.highlight.name ?? null,
    contentHighlights: contentHighlights.length > 0 ? contentHighlights : null,
    source: 'service' as const,
  };
};

const useMapSearchResponseItem = () => {
  const channelsContext = useChannelsContext();
  const channels = () => channelsContext.channels();

  const history = useHistory();

  return (
    result: UnifiedSearchResponseItem,
    searchQuery?: string
  ): Entity | undefined => {
    switch (result.type) {
      case 'document': {
        if (!result.metadata || result.metadata.deleted_at) return;
        const search = ['md', 'pdf'].includes(result.file_type)
          ? getLocationHighlights(
              result.document_search_results,
              result.file_type as FileTypeWithLocation,
              searchQuery
            )
          : getHighlights(result.document_search_results);
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
        const search = getHighlights(result.email_message_search_results);
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
        const search = getHighlights(result.chat_search_results);
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

        // TODO: serialize correctly from backend
        const latestMessage = channelWithLatest?.latest_message
          ? {
              content: channelWithLatest.latest_message.content,
              senderId: channelWithLatest.latest_message.sender_id,
              createdAt:
                new Date(
                  channelWithLatest.latest_message.created_at
                ).getTime() / 1000,
            }
          : undefined;

        const search = getHighlights(result.channel_message_search_results);

        return {
          type: 'channel',
          // TODO: distinguish channel name match from channel message match
          id: result.channel_id,
          name: result.name ?? channelWithLatest?.name ?? '',
          ownerId: result.owner_id ?? '',
          createdAt: result.metadata?.created_at,
          updatedAt: result.metadata?.updated_at,
          channelType: result.channel_type as ChannelType,
          interactedAt: result.metadata?.interacted_at ?? undefined,
          latestMessage,
          search,
        };
      }

      case 'project': {
        if (!result.metadata || result.metadata.deleted_at) return;
        const search = getHighlights(result.project_search_results);
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
