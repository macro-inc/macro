import { createPaginatedEmailSearchResource } from '@core/signal/search';
import { createMemo } from 'solid-js';
import type { EmailSearchResponseItem } from '../../../service-search/generated/models/emailSearchResponseItem';
import type { CommandItemCard } from './KonsoleItem';

function transformEmailResultsToItems(
  emailResults: EmailSearchResponseItem[]
): CommandItemCard[] {
  const items: CommandItemCard[] = [];

  for (const email of emailResults) {
    if (email.email_message_search_results.length === 0) continue;

    for (const result of email.email_message_search_results) {
      const contents = Array.isArray(result.content) ? result.content : [''];
      contents.forEach((content, index) => {
        items.push({
          type: 'email',
          data: {
            id: email.thread_id,
            name: result.subject as string,
            sender: result.sender,
            // Email TODO: This should be sent time, not update time
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
  }

  return items;
}

export function useEmailItems(fullTextSearchTerm: () => string) {
  const PAGE_SIZE = 25;

  const { data, loadMore, refresh } = createPaginatedEmailSearchResource(
    fullTextSearchTerm,
    PAGE_SIZE
  );

  const items = createMemo(() => {
    const data_ = data();
    if (!data_) return [];
    return transformEmailResultsToItems(data_.results);
  });

  return {
    items,
    hasMore: data()?.hasMore ?? false,
    state: data.state,
    loadMore,
    refresh,
  };
}
