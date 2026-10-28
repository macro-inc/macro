import { createQueryKeys } from '@lukemorales/query-key-factory';

export const botKeys = createQueryKeys('bots', {
  list: null,
  detail: (botId: string) => ({ queryKey: [botId] }),
  channels: (botId: string) => ({ queryKey: [botId] }),
  tokens: (botId: string) => ({ queryKey: [botId] }),
});

export const botProfileKeys = createQueryKeys('bot-owner-profiles', {
  detail: (botId: string) => ({ queryKey: [botId] }),
});
