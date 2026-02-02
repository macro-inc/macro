import { createQueryKeys } from '@lukemorales/query-key-factory';

export const previewKeys = createQueryKeys('preview', {
  item: (itemId: string) => {
    return {
      queryKey: [itemId],
      contextQueries: {
        channelMessage: (messageId: string) => {
          return { queryKey: [messageId] };
        },
      },
    };
  },
});
