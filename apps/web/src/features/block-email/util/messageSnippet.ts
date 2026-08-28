import { extractEmailTextSnippet } from '@core/email';
import type { ApiMessage } from '@service-email/generated/schemas';

/** Plain-text preview for collapsed rows and deferred body placeholders. */
export function getMessageSnippet(message: ApiMessage): string {
  if (message.snippet) {
    return message.snippet.replace(/\s+/g, ' ').trim();
  }
  if (message.body_text) {
    return message.body_text.replace(/\s+/g, ' ').trim();
  }
  if (message.body_html_sanitized) {
    return extractEmailTextSnippet(message.body_html_sanitized);
  }
  return '';
}
