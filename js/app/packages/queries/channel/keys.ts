import { createQueryKeys } from '@lukemorales/query-key-factory';

export const channelKeys = createQueryKeys('channel', {
  channel: (channelID: string) => ({
    queryKey: [channelID],
  }),
});
