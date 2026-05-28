import { createQueryKeys } from '@lukemorales/query-key-factory';

export const channelKeys = createQueryKeys('channel', {
  withID: (channelID: string) => ({
    queryKey: [channelID],
  }),
  mentions: (channelID: string) => ({
    queryKey: [channelID],
  }),
  messages: (channelID: string, loadAroundMessageId: string | null = null) => ({
    queryKey: [channelID, { loadAroundMessageId }],
  }),
  messagesByIds: (channelID: string, messageIds: string[]) => ({
    queryKey: [channelID, { messageIds }],
  }),
  attachments: (channelID: string, attachmentType?: string) => ({
    queryKey: attachmentType ? [channelID, { attachmentType }] : [channelID],
  }),
  participants: (channelID: string) => ({
    queryKey: [channelID],
  }),
  threadReplies: (channelID: string, messageID: string) => ({
    queryKey: [channelID, messageID],
  }),
  activity: null,
  listChannels: null,
});

export const ChannelNonceKeys = {
  MESSAGE: 'comms_message',
  REACTION: 'comms_reaction',
  TYPING: 'comms_typing',
  ATTACHMENT: 'comms_attachment',
} as const;
