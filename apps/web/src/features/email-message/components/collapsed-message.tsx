import type { EmailMessage } from '@app/features/email-message/core/email-message';
import { Tooltip } from '@ui';
import { createMemo, type JSX, Show } from 'solid-js';
import { getSenderDisplayName } from '../core/email-user';
import { formatFullDate, formatShortDate } from '../core/format-email-date';

interface CollapsedMessageProps {
  message: EmailMessage;
  avatar?: JSX.Element;
  currentUserEmail?: string;
}

/** Collapsed thread row: sender, snippet, date. The chrome is MessageCard's. */
export function CollapsedMessage(props: CollapsedMessageProps) {
  const currentUserEmail = () => props.currentUserEmail;

  const senderDisplay = createMemo(() =>
    getSenderDisplayName(props.message, currentUserEmail())
  );
  const snippet = createMemo(() => {
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
    <div class="min-w-0 grid grid-cols-[7rem_minmax(0,1fr)_4.5rem] items-center gap-x-2 @max-[480px]/message:grid-cols-[minmax(0,1fr)_auto] @max-[480px]/message:gap-y-2">
      <div class="flex items-center min-h-6 gap-2 min-w-0 text-sm @max-[480px]/message:col-start-1 @max-[480px]/message:row-start-1">
        {/* The whole collapsed row opens the message, so its sender is not a
            person-card trigger: a card here covers the messages below it, and
            a tap on the avatar would open the card instead of the message. */}
        <div class="shrink-0 flex justify-center items-center size-6 pointer-events-none">
          {props.avatar}
        </div>
        <div class="min-w-0">
          <span class="text-ink line-clamp-1">{senderDisplay()}</span>
        </div>
      </div>
      <div class="min-w-0 text-base text-ink-extra-muted overflow-hidden text-ellipsis whitespace-nowrap @max-[480px]/message:col-span-full @max-[480px]/message:row-start-2 @max-[480px]/message:whitespace-normal @max-[480px]/message:line-clamp-2 mobile:line-clamp-1">
        {snippet()}
      </div>
      <Show when={props.message.internal_date_ts}>
        <span class="flex items-center min-h-6 justify-self-end @max-[480px]/message:col-start-2 @max-[480px]/message:row-start-1">
          <Tooltip
            as="span"
            label={formatFullDate(props.message.internal_date_ts!)}
          >
            <span class="text-sm text-ink-extra-muted/60 tabular-nums">
              {formatShortDate(props.message.internal_date_ts!)}
            </span>
          </Tooltip>
        </span>
      </Show>
    </div>
  );
}
