import type { MessageWithBodyReplyless } from '@service-email/generated/schemas';
import { createMemo } from 'solid-js';

interface CollapsedMessageRowProps {
  message: MessageWithBodyReplyless;
  onClick: () => void;
}

/**
 * Compact single-line content for collapsed email messages.
 * Styled to be visually distinct from expanded messages.
 */
export function CollapsedMessageRow(props: CollapsedMessageRowProps) {
  const snippet = createMemo(() => {
    // Prefer body_text for snippet, fall back to stripping HTML
    if (props.message.body_text) {
      return props.message.body_text.replace(/\s+/g, ' ').trim();
    }
    if (props.message.body_html_sanitized) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(
        props.message.body_html_sanitized,
        'text/html'
      );
      return doc.body.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    }
    return '';
  });

  return (
    <div
      class="text-ink-extra-muted truncate text-sm py-1 -my-1 cursor-pointer hover:text-ink-muted transition-colors"
      onClick={props.onClick}
    >
      {snippet()}
    </div>
  );
}
