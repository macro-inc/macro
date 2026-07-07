import type { MessageEditor } from '@channel/Channel/create-message-editor';
import type { NewMessageCheckable } from '@channel/Channel/util';
import type { InputHandle, InputSnapshot } from '@channel/Input';
import type { IUser } from '@core/user/types';
import type { ApiChannelMessage } from '@service-storage/generated/schemas/apiChannelMessage';
import type { Accessor, Setter } from 'solid-js';
import type {
  ChannelMessageListMeta,
  MessageActions,
  MessageData,
} from '../Message';
import type { FocusRequest } from './focus-request';

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
  replyInputEl?: Accessor<HTMLElement | undefined>;
  setReplyInputEl?: Setter<HTMLElement | undefined>;
  replyInputHandle?: Accessor<InputHandle | undefined>;
  setReplyInputHandle?: Setter<InputHandle | undefined>;
  replyInputFocusRequest: FocusRequest;
};

export type MessageEditState = {
  messageId: string;
  /** The message as it was when the edit started. */
  message: MessageData;
  snapshot: InputSnapshot;
};

export type ThreadProps = {
  data: Accessor<ApiChannelMessage>;
  channelId: Accessor<string>;
  getMessageActions?: (message: MessageData) => MessageActions | undefined;
  listMeta?: ChannelMessageListMeta;
  threadActions?: ThreadActions;
  messageEditor?: MessageEditor;
  participants?: Accessor<IUser[]>;
  targetThreadId?: string;
  /** One-shot scroll target. Caller must clear via `onTargetReplyScrolled`. */
  targetReplyId?: string;
  onTargetReplyScrolled?: (replyId: string) => void;
  /** Navigation target reply */
  activeTargetReplyId?: string;
  /** The unified input's reply binding */
  unifiedReplyTarget?: { threadId: string; replyId?: string };
  isNewMessage?: (reply: NewMessageCheckable) => boolean;
  selectedMessageId?: Accessor<string | undefined>;
  onSelectMessage?: (messageId: string) => void;
  onClearSelection?: () => void;
  messageListScopeId?: string;
  isNewestThread?: boolean;
} & ThreadState;
