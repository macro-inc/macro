import { createQueryKeys } from '@lukemorales/query-key-factory';

export const metaMessagingKeys = createQueryKeys('meta-messaging', {
  configuration: null,
  history: (id: string, generation: string) => [id, generation],
  connections: (teamId: string) => [teamId],
  conversation: (channelId: string) => [channelId],
  delivery: (channelId: string, messageIds: string[]) => [
    channelId,
    messageIds,
  ],
  templates: (channelId: string) => [channelId],
});
