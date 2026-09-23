import { createQueryKeys } from '@lukemorales/query-key-factory';

export const channelLabelKeys = createQueryKeys('channel-labels', {
  list: null,
  preview: (pattern: string) => [pattern],
});
