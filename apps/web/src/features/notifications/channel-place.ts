import { groupChatName } from '@channel/group-chat-name';

/** The channel fields a channel notification's metadata carries. */
export type ChannelPlaceContent = {
  channelType?: string;
  channelName?: string;
};

/**
 * Where a channel event happened: a channel names itself as `#name`, a group
 * chat by its people, and a direct message says nothing, since the person
 * already says where.
 */
export function channelPlace(content: ChannelPlaceContent) {
  if (content.channelType === 'directMessage' || !content.channelName) return;
  if (content.channelType === 'private') {
    return groupChatName(content.channelName);
  }
  return content.channelType === 'public' || content.channelType === 'team'
    ? `#${content.channelName}`
    : content.channelName;
}
