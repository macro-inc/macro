// Copy of main's apps/web/src/lib/queries/channel/keys.ts at 393eee931fa9b40400297c3237ce1ad3e00323d3, verbatim below the marker
// except the import lines listed in check-copies.sh (paths that main resolved
// relative to its own directory). The proof runner checks this.
// ---- verbatim below ----
import { createQueryKeys } from '@lukemorales/query-key-factory';

export const channelKeys = createQueryKeys('channel-main', {
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
