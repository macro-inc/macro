import type { MessageEditor } from '@channel/Channel/create-message-editor';
import type { NewMessageCheckable } from '@channel/Channel/util';
import type { InputSnapshot } from '@channel/Input';
import type { ApiChannelMessage } from '@service-comms/client';
import type { Accessor, Setter } from 'solid-js';
import type {
  ChannelMessageListMeta,
  MessageActions,
  MessageData,
} from '../Message';

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
  messageEditor?: MessageEditor;
  /**
   * The controller's currently-active target message id (find-bar /
   * URL-deeplink). The highlight rendering also derives from this so the
   * orange bar can resolve directly from the controller state — it doesn't
   * depend on `selection.selectedId` having survived auto-clear or scroll
   * races during a load-around fetch.
   */
  activeTargetMessageId?: string;
  targetReplyId?: string;
  onTargetReplyScrolled?: (replyId: string) => void;
  isNewMessage?: (reply: NewMessageCheckable) => boolean;
  selectedMessageId?: Accessor<string | undefined>;
  onSelectMessage?: (messageId: string) => void;
  onClearSelection?: () => void;
  messageListScopeId?: string;
  isNewestThread?: boolean;
} & ThreadState;
