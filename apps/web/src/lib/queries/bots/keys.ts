import { createQueryKeys } from '@lukemorales/query-key-factory';

export const botKeys = createQueryKeys('bots', {
  list: null,
  mentionable: null,
  personas: null,
  persona: (botId: string) => ({ queryKey: [botId] }),
  detail: (botId: string) => ({ queryKey: [botId] }),
  channels: (botId: string) => ({ queryKey: [botId] }),
  tokens: (botId: string) => ({ queryKey: [botId] }),
});
