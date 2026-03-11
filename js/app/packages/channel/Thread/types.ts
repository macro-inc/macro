import type { ApiChannelMessage } from '@service-comms/client';
import type {
  ChannelMessageListMeta,
  MessageActions,
  MessageData,
} from '../Message';
import type { Accessor, Setter } from 'solid-js';
import type { InputSnapshot } from '@channel/Input';

export type ThreadActions = {
  onDismissNewMessages?: () => void;
};

export type ThreadState = {
  isExpanded: Accessor<boolean>;
  setIsExpanded: Setter<boolean>;
  isReplying: Accessor<boolean>;
  setIsReplying: Setter<boolean>;
  replyInputState: Accessor<InputSnapshot | undefined>;
  setReplyInputState: Setter<InputSnapshot | undefined>;
};

export type MessageEditState = {
  messageId: string;
  snapshot: InputSnapshot;
};

export type ThreadProps = {
  data: Accessor<ApiChannelMessage>;
  channelId: Accessor<string>;
  getMessageActions?: (message: MessageData) => MessageActions | undefined;
  listMeta?: ChannelMessageListMeta;
  threadActions?: ThreadActions;
  editState?: Accessor<MessageEditState | undefined>;
  onEditChange?: (message: MessageData, snapshot: InputSnapshot) => void;
  onEditCancel?: (messageId: string) => void;
  onEditSave?: (message: MessageData, snapshot: InputSnapshot) => void;
} & ThreadState;
