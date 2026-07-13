export const CHANNEL_TABS = [
  { value: 'messages', label: 'Messages' },
  { value: 'attachments', label: 'Attachments' },
  { value: 'participants', label: 'Participants' },
  { value: 'call', label: 'Call' },
] as const;

export type ChannelTabId = (typeof CHANNEL_TABS)[number]['value'];

export const DEFAULT_CHANNEL_TAB: ChannelTabId = 'messages';
