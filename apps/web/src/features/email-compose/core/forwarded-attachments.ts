import type {
  EmailAttachment,
  EmailMessage,
} from '@app/features/email-message/core/email-message';
import {
  inlineContentIds,
  normalizeContentId,
  staticFileIdsByContentId,
} from '@app/features/email-message/core/inline-images';

/**
 * Attachments a forward of the message carries. Inline images with a
 * static-file copy reach the recipient as links in the quoted body instead;
 * every other attachment, including an inline image without a copy, is
 * attached so the recipient still gets it.
 */
export function forwardedAttachments(
  message: Pick<EmailMessage, 'attachments' | 'body_html_sanitized'>
): EmailAttachment[] {
  const shownInline = inlineContentIds(message.body_html_sanitized ?? '');
  const linked = staticFileIdsByContentId(message.attachments);
  return (message.attachments ?? []).filter((attachment) => {
    if (attachment.reference_url) return false;
    if (!attachment.content_id) return true;
    const contentId = normalizeContentId(attachment.content_id);
    return !shownInline.has(contentId) || !linked.has(contentId);
  });
}
