import { ENABLE_SEARCH_SERVICE } from '@core/constant/featureFlags';
import { useSearch } from '@core/signal/search';
import { isErr } from '@core/util/maybeResult';
import type { BasicDocumentFileType } from '@service-storage/generated/schemas/basicDocumentFileType';
import { createEffect, createMemo, createSignal } from 'solid-js';
import { searchClient } from '../../../service-search/client';
import type { UnifiedSearchResponse } from '../../../service-search/generated/models/unifiedSearchResponse';
import type { UnifiedSearchResponseItem } from '../../../service-search/generated/models/unifiedSearchResponseItem';
import type { CommandItemCard } from './KonsoleItem';

function createDocumentItems(
  doc: UnifiedSearchResponseItem
): CommandItemCard[] {
  const items: CommandItemCard[] = [];
  if (doc.type !== 'document') return [];

  if (
    doc.document_search_results.length === 0 ||
    !doc.metadata ||
    doc.metadata.deleted_at
  )
    return [];

  // TODO: de-duplicate: see logic in useDocumentItems
  for (const result of doc.document_search_results) {
    const contents = result.highlight.content ?? [];
    contents.forEach((content, index) => {
      // TODO: Canvas returns some nasty partial <m-foo> tags in plaintext
      //         so they are banned from search display for now.
      if (doc.file_type !== 'canvas') {
        items.push({
          type: 'item',
          data: {
            id: doc.document_id,
            name: doc.document_name,
            fileType: doc.file_type as BasicDocumentFileType,
            itemType: 'document',
          },
          snippet: {
            content,
            locationId: result.node_id,
            fileType: doc.file_type,
            matchIndex: index,
          },
          updatedAt: result.updated_at * 1000, // Convert Unix timestamp to milliseconds
        });
      }
    });
  }

  return items;
}

function createEmailItems(email: UnifiedSearchResponseItem): CommandItemCard[] {
  const items: CommandItemCard[] = [];
  if (email.type !== 'email') return [];

  if (email.email_message_search_results.length === 0) return [];

  // TODO: de-duplicate: see logic in useEmailItems
  for (const result of email.email_message_search_results) {
    const contents = result.highlight.content ?? [];
    contents.forEach((content, index) => {
      items.push({
        type: 'email',
        data: {
          id: email.thread_id,
          name: result.subject as string,
          sender: result.sender,
          // TODO: This should be sent time, not update time
          timestamp: new Date(result.updated_at * 1000).toISOString(),
          is_read: result.labels.indexOf('UNREAD') >= 0,
          // TODO: This should be the attachments from the email, need to update the search service to return them
          attachments: [],
        },
        snippet: {
          content,
          locationId: result.message_id,
          fileType: 'email',
          matchIndex: index,
        },
      });
    });
  }

  return items;
}

function createChatItems(chat: UnifiedSearchResponseItem): CommandItemCard[] {
  const items: CommandItemCard[] = [];
  if (chat.type !== 'chat') return [];

  if (
    chat.chat_search_results.length === 0 ||
    !chat.metadata ||
    chat.metadata.deleted_at
  )
    return [];

  // TODO: de-duplicate: see logic in useChatItems
  for (const result of chat.chat_search_results) {
    const contents = result.highlight.content ?? [];
    contents.forEach((content, index) => {
      items.push({
        type: 'item',
        data: {
          id: chat.chat_id,
          name: result.title,
          itemType: 'chat',
        },
        snippet: {
          content,
          locationId: result.chat_message_id,
          fileType: 'chat',
          matchIndex: index,
          senderId: chat.user_id,
        },
        updatedAt: result.updated_at * 1000, // Convert Unix timestamp to milliseconds
      });
    });
  }

  return items;
}

function createChannelItems(
  channel: UnifiedSearchResponseItem
): CommandItemCard[] {
  const items: CommandItemCard[] = [];
  if (channel.type !== 'channel') return [];

  if (channel.channel_message_search_results.length === 0) return [];

  for (const result of channel.channel_message_search_results) {
    const contents = result.highlight.content ?? [];
    contents.forEach((content, index) => {
      items.push({
        type: 'channel',
        data: {
          id: channel.channel_id,
          name: '', // Set name to empty string since search results don't contain channel names anymore
        },
        snippet: {
          content,
          locationId: result.message_id,
          fileType: 'chat',
          matchIndex: index,
          senderId: result.sender_id,
        },
        updatedAt: result.updated_at * 1000, // Convert Unix timestamp to milliseconds
      });
    });
  }

  return items;
}

function createProjectItems(
  project: UnifiedSearchResponseItem
): CommandItemCard[] {
  const items: CommandItemCard[] = [];
  if (project.type !== 'project') return [];

  if (
    project.project_search_results.length === 0 ||
    !project.metadata ||
    project.metadata.deleted_at
  )
    return [];

  for (const result of project.project_search_results) {
    const contents = result.highlight.content ?? [];
    contents.forEach((_content, _index) => {
      items.push({
        type: 'item',
        data: {
          id: project.id,
          name: project.name,
          fileType: 'project',
          itemType: 'project',
        },
      });
    });
  }

  return items;
}

function convertSearchResultsToItems(
  searchResults: UnifiedSearchResponse
): CommandItemCard[] {
  if (!searchResults || !searchResults.results) return [];

  let items: CommandItemCard[] = [];

  for (const result of searchResults.results) {
    switch (result.type) {
      case 'email':
        items = items.concat(createEmailItems(result));
        break;
      case 'chat':
        items = items.concat(createChatItems(result));
        break;
      case 'document':
        items = items.concat(createDocumentItems(result));
        break;
      case 'channel':
        items = items.concat(createChannelItems(result));
        break;
      case 'project':
        items = items.concat(createProjectItems(result));
        break;
      default:
        break;
    }
  }

  return items;
}

export function useSearchItems(searchTerm: () => string) {
  const unifiedSearchResults = useSearch(searchTerm);
  return createMemo(() => {
    const searchResults = unifiedSearchResults();
    if (!searchResults) return [];
    return convertSearchResultsToItems(searchResults);
  });
}

export function usePaginatedSearchItems(searchTerm: () => string) {
  const [allItems, setAllItems] = createSignal<CommandItemCard[]>([]);
  const [currentPage, setCurrentPage] = createSignal(0);
  const [hasMore, setHasMore] = createSignal(true);
  const [isLoading, setIsLoading] = createSignal(false);
  let loadMoreAbortController: AbortController | null = null;

  // Reset when search term changes
  createEffect(() => {
    const term = searchTerm();
    if (term !== '') {
      if (loadMoreAbortController) {
        loadMoreAbortController.abort();
        loadMoreAbortController = null;
      }
      setAllItems([]);
      setCurrentPage(0);
      setHasMore(true);
    }
  });

  // Load first page when search term changes
  const searchResults = useSearch(searchTerm);
  createEffect(() => {
    const results = searchResults();
    if (results && currentPage() === 0) {
      const items = convertSearchResultsToItems(results);
      setAllItems(items);
      // Hardcode hasMore to always be true for now
      setHasMore(true);
    }
  });

  const loadMore = async () => {
    if (isLoading()) return;

    if (loadMoreAbortController) {
      loadMoreAbortController.abort();
    }
    loadMoreAbortController = new AbortController();

    setIsLoading(true);
    try {
      const nextPage = currentPage() + 1;
      const term = searchTerm();

      if (!ENABLE_SEARCH_SERVICE || term.length < 3) {
        return;
      }

      const result = await searchClient.search(
        {
          request: {
            match_type: 'partial',
            query: term,
          },
          params: { page: nextPage, page_size: 10 },
        },
        { signal: loadMoreAbortController.signal }
      );

      if (isErr(result)) {
        console.error('Failed to load more search results');
        return;
      }

      const [, data] = result;
      if (data) {
        const newItems = convertSearchResultsToItems(data);
        setAllItems((prev) => [...prev, ...newItems]);
        setCurrentPage(nextPage);
        if (newItems.length === 0) setHasMore(false);
      }
    } catch (error) {
      if (loadMoreAbortController.signal.aborted) return;

      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  return {
    items: allItems,
    hasMore,
    isLoading,
    loadMore,
  };
}
