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
  attachments: ApiMessageAttachment[];
  reactions: ApiCountedReaction[];
};
