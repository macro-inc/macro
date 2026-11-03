import { createQueryKeys } from '@lukemorales/query-key-factory';

export const channelKeys = createQueryKeys('channel', {
  picture: (channelId: string) => ({ queryKey: [channelId] }),
  withID: (channelID: string) => ({
    queryKey: [channelID],
  }),
  mentions: (channelID: string) => ({
    queryKey: [channelID],
  }),
  attachments: (channelID: string, attachmentType?: string) => ({
    queryKey: attachmentType ? [channelID, { attachmentType }] : [channelID],
  }),
  participants: (channelID: string) => ({
    queryKey: [channelID],
  }),
  channelBots: (channelID: string) => ({
    queryKey: [channelID],
  }),
  activity: null,
  listChannels: {
    queryKey: null,
    contextQueries: {
      account: (actorId?: string) => [actorId ?? 'signed-out'],
    },
  },
  quickAccessGraphql: (cacheClientId: string) => ({
    queryKey: [cacheClientId],
  }),
});
