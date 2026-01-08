import { createQueryKeys } from '@lukemorales/query-key-factory';

export const channelKeys = createQueryKeys('channel', {
  withID: (channelID: string) => ({
    queryKey: [channelID],
  }),
});
