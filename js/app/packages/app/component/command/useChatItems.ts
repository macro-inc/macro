import { useSearchChats } from '@core/signal/search';
import { createMemo } from 'solid-js';
import type { CommandItemCard } from './KonsoleItem';

export function useChatItems(fullTextSearchTerm: () => string) {
  const chatSearchResults = useSearchChats(fullTextSearchTerm);

  return createMemo(() => {
    const chatResults = chatSearchResults();
    if (!chatResults) return [];

    const items: CommandItemCard[] = [];
    for (const chat of chatResults.results) {
      if (chat.chat_search_results.length === 0 || chat.metadata?.deleted_at)
        continue;
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
            },
          });
        });
      }
    }
    return items;
  });
}
