import type { ApiChannelMessage } from '@service-comms/client';
import type { ChannelMessageListMeta, MessageActions, MessageData } from '../Message';
import type { Accessor, Setter } from 'solid-js';

export type ThreadState = {
  isExpanded: Accessor<boolean>;
  setIsExpanded: Setter<boolean>;
};

export type ThreadProps = {
  data: Accessor<ApiChannelMessage>;
  channelId: Accessor<string>;
  getMessageActions?: (message: MessageData) => MessageActions | undefined;
  listMeta?: ChannelMessageListMeta;
  onDismissNewMessages?: () => void;
} & ThreadState;
