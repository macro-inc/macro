import type { InboundAttachment } from '../../whatsapp-linked/core/attachments';
import type { DeliveryState } from '../../whatsapp-linked/core/delivery';

/** Feature vocabulary; transport decoding lives in queries/. */
export type GroupSummary = {
  id: string;
  name: string;
  unreadCount: number;
};
export type GroupDetail = {
  id: string;
  name: string;
  ownerId: string;
  accessLevel: 'view' | 'comment' | 'edit' | 'owner';
  canSend: boolean;
  sendReason?: string;
  phone?: string;
  lastReadMessageId?: string;
  unreadCount: number;
  members: { id: string; name: string; admin: boolean }[];
  limits: {
    textBytes: number;
    attachmentBytes: number;
    attachmentTypes: string[];
    editSeconds: number;
    mutations: ('reaction' | 'edit' | 'delete')[];
  };
};
export type GroupMessage = {
  id: string;
  sender: { name: string; userId?: string };
  body: string;
  sentAt: string;
  edited: boolean;
  deleted: boolean;
  replyTo?: string;
  reactions: { emoji: string; count: number; mine: boolean }[];
  attachments: InboundAttachment[];
  delivery?: DeliveryState;
};
export type MessagePage = { messages: GroupMessage[]; before?: string };
export type PendingSend = {
  id: string;
  preview: string;
  state: DeliveryState;
  errorCode?: string;
};
export type GroupSend =
  | { kind: 'text'; text: string; replyTo?: string }
  | { kind: 'media'; uploadId: string; caption?: string; replyTo?: string }
  | { kind: 'reaction'; messageId: string; emoji: string }
  | { kind: 'edit'; messageId: string; text: string }
  | { kind: 'delete'; messageId: string };

/** Both identity and the current backend limit are required for message changes. */
export function canChangeMessage(
  message: GroupMessage,
  userId: string | undefined,
  group: GroupDetail,
  now: number,
  operation: 'edit' | 'delete'
): boolean {
  const age = now - Date.parse(message.sentAt);
  return (
    !!userId &&
    group.canSend &&
    group.limits.mutations.includes(operation) &&
    !message.deleted &&
    message.sender.userId === userId &&
    age >= 0 &&
    age < group.limits.editSeconds * 1000
  );
}

export function composerNote(group: GroupDetail): string {
  if (group.canSend)
    return group.phone
      ? `Sending as ${group.phone}`
      : 'Sending from your WhatsApp';
  if (group.sendReason === 'no_account' || group.sendReason === 'disconnected')
    return 'Connect your WhatsApp to reply';
  if (group.sendReason === 'not_member' || group.sendReason === 'not_observing')
    return "Your WhatsApp isn't in this group";
  if (group.sendReason === 'not_allowed_in_group')
    return "Your WhatsApp can't post in this group";
  if (group.sendReason === 'refreshing')
    return 'Refreshing this group from WhatsApp…';
  if (group.sendReason === 'group_unavailable')
    return 'This group is no longer syncing';
  return 'Sending to WhatsApp is unavailable right now';
}
