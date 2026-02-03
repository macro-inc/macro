import { createQueryKeys } from '@lukemorales/query-key-factory';

export const channelKeys = createQueryKeys('channel', {
  withID: (channelID: string) => ({
    queryKey: [channelID],
  }),
  mentions: (channelID: string) => ({
    queryKey: [channelID],
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
