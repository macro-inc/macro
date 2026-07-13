import { createQueryKeys } from '@lukemorales/query-key-factory';

export const previewKeys = createQueryKeys('preview', {
  item: (itemId: string) => {
    return {
      queryKey: [itemId],
      contextQueries: {
        channelMessage: (channelId: string, messageId: string) => {
          return { queryKey: [channelId, messageId] };
        },
      },
    };
  },
});
