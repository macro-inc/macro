import { createQueryKeys } from '@lukemorales/query-key-factory';

export const callKeys = createQueryKeys('call', {
  active: (channelId: string) => ({
    queryKey: [channelId],
  }),
});
