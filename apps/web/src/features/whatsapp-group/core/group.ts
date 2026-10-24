import { match, P } from 'ts-pattern';
import type { InboundAttachment } from './attachments';

/** Feature vocabulary; transport decoding lives in queries/. */
export type GroupSummary = {
  id: string;
  name: string;
  unreadCount: number;
  /** False for viewers who can only read. */
  canSend: boolean;
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
    maxAttachments: number;
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
  /** Sent from this page and not yet in WhatsApp; never openable. */
  pending?: boolean;
};
export type MessagePage = { messages: GroupMessage[]; before?: string };
export type GroupSend =
  | { kind: 'text'; text: string; replyTo?: string }
  | { kind: 'media'; uploadId: string; caption?: string; replyTo?: string }
  | { kind: 'reaction'; messageId: string; emoji: string }
  | { kind: 'edit'; messageId: string; text: string }
  | { kind: 'delete'; messageId: string };

/** A recorded send, as DSS reports its progress. */
export type SendProgress = {
  id: string;
  state:
    | 'pending'
    | 'sending'
    | 'unknown'
    | 'accepted'
    | 'sent'
    | 'delivered'
    | 'read'
    | 'failed';
  messageId?: string;
  errorCode?: string;
};

/**
 * Why a write did not go through. `refused` was never recorded, so the same
 * draft can be sent again; `unknown` may have been recorded, so a retry reuses
 * its idempotency key.
 */
export type SendFailure =
  | { kind: 'refused'; reason: string }
  | { kind: 'unknown' };

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
    !message.pending &&
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
  return match(group.sendReason)
    .with(
      P.union('no_account', 'disconnected'),
      () => 'Connect your WhatsApp to reply'
    )
    .with(
      P.union('not_member', 'not_observing'),
      () => "Your WhatsApp isn't in this group"
    )
    .with(
      'not_allowed_in_group',
      () => "Your WhatsApp can't post in this group"
    )
    .with('group_unavailable', () => 'This group is no longer syncing')
    .with('sending_disabled', () => 'Sending to WhatsApp is turned off')
    .otherwise(() => 'Sending to WhatsApp is unavailable right now');
}

/** A send's outcome after DSS recorded it. */
export function recordedOutcome(
  progress: SendProgress
): 'waiting' | 'accepted' | { failed: string } {
  return match(progress.state)
    .with(P.union('pending', 'sending'), () => 'waiting' as const)
    .with(
      P.union('accepted', 'sent', 'delivered', 'read'),
      () => 'accepted' as const
    )
    .with(P.union('failed', 'unknown'), () => ({
      failed: deliveryFailure(progress),
    }))
    .exhaustive();
}

/** Known delivery failures in plain words; never a provider response. */
function deliveryFailure(progress: SendProgress): string {
  // DSS never resends an unknown outcome; resending the restored draft reuses
  // its key, so it cannot arrive twice.
  if (progress.state === 'unknown')
    return "WhatsApp didn't confirm this message.";
  return match(progress.errorCode ?? '')
    .with(
      'send_expired',
      () => "WhatsApp wasn't reachable for 10 minutes, so this wasn't sent."
    )
    .with(
      'group_detached',
      () => 'This group stopped syncing before the message was sent.'
    )
    .with(
      'target_unavailable',
      () => 'The message you replied to or changed is no longer in WhatsApp.'
    )
    .with(
      'disconnected',
      () => 'Your WhatsApp disconnected before this was sent.'
    )
    .otherwise(() => "WhatsApp didn't accept this message.");
}
