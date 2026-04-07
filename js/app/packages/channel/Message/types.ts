import type { ApiMessageAttachment } from '@service-storage/generated/schemas/apiMessageAttachment';
import type { ApiCountedReaction } from '@service-storage/generated/schemas/apiCountedReaction';

export type MessageData = {
  id: string;
  content: string;
  sender_id: string;
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
  onEdit?: MessageActionHandler;
  onDelete?: MessageActionHandler;
  onCreateTask?: MessageActionHandler;
};
