import type { SenderInbox } from '@app/features/email-compose/core/email-sender';
import { canReplyAll } from '@app/features/email-compose/core/recipient-conversion';
import type { ReplyType } from '@app/features/email-compose/core/reply-type';
import type { EmailMessage } from '@app/features/email-message/core/email-message';

import type { Setter } from 'solid-js';
import type { EmailThreadState } from './email-thread-state';

/**
 * Whether to offer Reply All beside Reply. The viewer is every inbox they
 * hold and its send-as aliases, so a shared-thread recipient replying from
 * their own inbox is excluded too.
 */
export function offersReplyAll(
  message: EmailMessage,
  viewerEmail: string | undefined,
  inboxes: readonly SenderInbox[]
) {
  const ownAddresses = inboxes.flatMap((inbox) => [
    inbox.email_address,
    ...(inbox.sendAs ?? []).map((alias) => alias.email_address),
  ]);
  if (viewerEmail) ownAddresses.push(viewerEmail);
  return canReplyAll(message, ownAddresses);
}

export function openEmailReplyComposerForMessage(args: {
  ctx: EmailThreadState;
  /** Touch layouts reply in the full-screen composer; the inline reply input only
   * renders for non-touch. Phone width alone is not the gate: tablets are
   * touch at desktop widths. */
  isTouch: boolean;
  message: EmailMessage;
  replyType: ReplyType;
  isLastMessage?: boolean;
  setShowReply?: Setter<boolean>;
}) {
  const messageId = args.message.db_id;
  if (!messageId) return false;

  const permissions = args.ctx.permissions();
  if (!permissions.canReply) return false;
  // A forward re-sends the message's attachments, which only the inbox holding
  // them can do; recipients of a shared thread reply instead.
  if (args.replyType === 'forward' && !permissions.isOwner) return false;

  // The reply type and focus land through the reply request: the mounted
  // composer's effect applies them to its own (seed-keyed) form instance.
  // Writing to the form registry from here would target the wrong entry —
  // the registry key includes a seed only the composer knows.
  args.ctx.replyRequest.set(messageId, args.replyType);

  if (args.isTouch) {
    args.ctx.mobileReplyComposer.openForMessage(messageId);
    return true;
  }

  if (args.setShowReply) {
    args.setShowReply(true);
    return true;
  }

  if (args.isLastMessage) {
    args.ctx.messages.setBottomReplyOpen(true);
  } else {
    args.ctx.messages.setExpandedBodyId(messageId, true);
    args.ctx.messages.setFocused(messageId);
    args.ctx.messages.setReplyingToMessageId(messageId);
  }

  return true;
}
