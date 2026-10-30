import type { EmailMessage } from '../../email-message/core/email-message';
import { isViewerAddress } from '../../email-message/core/email-user';
import type { EmailThread } from './email-thread';

/**
 * Sender actions target the earliest sender other than the viewer: the
 * inbox's own address or any other address of theirs. With no inbox address
 * the viewer is unknown, so no sender is.
 */
export function selectThreadSender(
  thread: EmailThread,
  viewerEmail?: string,
  ...otherViewerEmails: (string | undefined)[]
) {
  if (!viewerEmail) return undefined;
  const viewer = [viewerEmail, ...otherViewerEmails];
  return selectThreadMessages(thread).messages.find(
    (message) =>
      message.from?.email &&
      !viewer.some((email) => isViewerAddress(message.from?.email, email))
  )?.from?.email;
}

/**
 * The message a thread downloads as `.eml`: the newest one sent or received,
 * which quotes the conversation before it. Drafts and sends still on their
 * way have no provider copy yet.
 */
export function selectEmlMessage(thread: EmailThread) {
  let newest: EmailMessage | undefined;
  for (const message of selectThreadMessages(thread).messages) {
    if (message.is_draft || !message.provider_id) continue;
    if (!newest || messageTime(message) >= messageTime(newest)) {
      newest = message;
    }
  }
  return newest;
}

/** When a message happened, falling back to when Macro first saw it. */
function messageTime(message: EmailMessage) {
  return Date.parse(
    message.internal_date_ts ?? message.sent_at ?? message.created_at
  );
}

/** Select chronological messages and reply drafts without mutating the source. */
export function selectThreadMessages(thread: EmailThread) {
  const messages = thread.messages.filter(
    (message) => message.operation?.state !== 'DELETED'
  );
  // Sort all messages by recency
  messages.sort((a, b) => {
    if (a.internal_date_ts && b.internal_date_ts) {
      return (
        new Date(a.internal_date_ts).getTime() -
        new Date(b.internal_date_ts).getTime()
      );
    }
    // Below is fallback for when internal_date_ts is not set
    else if (a.sent_at && b.sent_at) {
      return new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime();
    }
    return 0;
  });

  const filtered = [];
  const messageDraftMap: Record<string, EmailMessage> = {};

  for (const message of messages) {
    if (!message.is_draft) {
      filtered.push(message);
      continue;
    }

    if (message.body_html_sanitized?.trim().length === 0) {
      continue;
    }

    const replyingToId = message.replying_to_id;

    if (!replyingToId) continue;

    const previous = messageDraftMap[replyingToId];
    if (
      !previous ||
      Date.parse(message.updated_at) > Date.parse(previous.updated_at)
    ) {
      messageDraftMap[replyingToId] = message;
    }
  }

  return {
    ...thread,
    messages: messages,
    filtered: filtered,
    draftMap: messageDraftMap,
  };
}
