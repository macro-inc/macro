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
  myAccessRequest: (channelID: string) => ({
    queryKey: [channelID],
  }),
  accessRequest: (channelID: string, requestID: string) => ({
    queryKey: [channelID, requestID],
  }),
  channelBots: (channelID: string) => ({
    queryKey: [channelID],
  }),
  activity: (userId: string | undefined) => ({ queryKey: [userId] }),
  listChannels: (userId: string | undefined) => ({ queryKey: [userId] }),
  quickAccessGraphql: (
    cacheClientId: string,
    userId: string | undefined,
    generation: number
  ) => ({
    queryKey: [cacheClientId, userId, generation],
  }),
});
