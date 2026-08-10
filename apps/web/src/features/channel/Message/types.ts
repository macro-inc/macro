import type { ApiCountedReaction } from '@service-storage/generated/schemas/apiCountedReaction';
import type { ApiMessageAttachment } from '@service-storage/generated/schemas/apiMessageAttachment';
import type { ApiMessageSender } from '@service-storage/generated/schemas/apiMessageSender';

export type MessageData = {
  id: string;
  /** `null`/absent on agent-session placeholder messages. */
  content?: string | null;
  /**
   * The folded agent-session message a placeholder renders, as the composite
   * `"{agent_session_id}:{turn}:{author}"`. Set only on placeholders.
   */
  agent_session_message_id?: string | null;
  sender_id: string;
  /** Structured sender identity; carries bot name/avatar for bot senders. */
  sender?: ApiMessageSender;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  edited_at?: string | null;
  thread_id?: string | null;
  attachments: ApiMessageAttachment[];
  reactions: ApiCountedReaction[];
};

export type MessageActionEvent = MouseEvent | KeyboardEvent;

export type MessageActionContext = {
  message: MessageData;
  event?: MessageActionEvent;
  emoji?: string;
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
