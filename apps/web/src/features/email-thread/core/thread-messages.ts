import type { EmailMessage } from '../../email-message/core/email-message';
import type { EmailThread } from './email-thread';

/** Sender actions historically target the earliest sender other than the viewer. */
export function selectThreadSender(thread: EmailThread, viewerEmail?: string) {
  const viewer = viewerEmail?.toLowerCase();
  return selectThreadMessages(thread).messages.find(
    (message) =>
      message.from?.email && message.from.email.toLowerCase() !== viewer
  )?.from?.email;
}

/** Select chronological messages and reply drafts without mutating the source. */
export function selectThreadMessages(thread: EmailThread) {
  const messages = [...thread.messages];
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

    messageDraftMap[replyingToId] = message;
  }

  return {
    ...thread,
    messages: messages,
    filtered: filtered,
    draftMap: messageDraftMap,
  };
}
