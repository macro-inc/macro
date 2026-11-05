import type {
  CountedReaction,
  MessageAttachment,
  MessageParent,
  MessageSender,
} from '@service-storage/messages';

/**
 * A reaction as the row shows it; `names` names reactors outside Macro
 * (an external chat's people), by their id in `users`.
 */
export type MessageReaction = CountedReaction & {
  names?: Record<string, string>;
};

export type MessageData = {
  parent?: MessageParent;
  imported_author?: { name: string } | null;
  guest_name?: string | null;
  id: string;
  content: string;
  sender_id: string;
  /** Structured sender identity; carries bot name/avatar for bot senders. */
  sender?: MessageSender;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  edited_at?: string | null;
  thread_id?: string | null;
  attachments: MessageAttachment[];
  reactions: MessageReaction[];
};

export type MessageActionEvent = MouseEvent | KeyboardEvent;

export type MessageActionContext = {
  message: MessageData;
  event?: MessageActionEvent;
  emoji?: string;
  /** Browser-selected text within this message at the time Reply was chosen. */
  selectedText?: string;
  /** Resolved text exposed by a dynamic decorator for use in reply previews. */
  renderedText?: string;
};

export type MessageActionHandler = (
  context: MessageActionContext
) => void | Promise<void>;

export type MessageActions = {
  onReply?: MessageActionHandler;
  onReact?: MessageActionHandler;
  onCopyLink?: MessageActionHandler;
  onCopyMessageText?: MessageActionHandler;
  onEdit?: MessageActionHandler;
  onDelete?: MessageActionHandler;
  onCreateTask?: MessageActionHandler;
  onChat?: MessageActionHandler;
};
