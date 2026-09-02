import { UserIcon, type UserIconProps } from '@core/component/UserIcon';
import { useEmail } from '@core/context/user';
import type { ApiMessage } from '@service-email/generated/schemas';
import { Tooltip } from '@ui';
import { createMemo, Show } from 'solid-js';
import { getSenderDisplayName, getSenderMacroId } from '../util/emailUser';
import { formatFullDate, formatShortDate } from '../util/formatEmailDate';
import { EmailUserTooltip } from './EmailUserTooltip';

interface CollapsedMessageProps {
  message: ApiMessage;
}

/** Collapsed thread row: sender, snippet, date. The chrome is MessageCard's. */
export function CollapsedMessage(props: CollapsedMessageProps) {
  const currentUserEmail = useEmail();

  const senderDisplay = createMemo(() =>
    getSenderDisplayName(props.message, currentUserEmail())
  );
  const senderMacroId = createMemo(() => getSenderMacroId(props.message));
  const senderIconProps = createMemo<UserIconProps>(() => {
    const senderId = senderMacroId();
    const photoUrl = props.message.from?.photo_url ?? undefined;
    if (senderId) return { id: senderId, photoUrl };
    return { email: props.message.from?.email ?? '', photoUrl };
  });

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
    <div class="macro-thread-collapsed-row min-w-0">
      <div
        data-slot="sender"
        class="macro-thread-message-header-row gap-2 min-w-0 text-sm"
      >
        <div class="shrink-0 flex justify-center items-center size-6">
          <UserIcon
            {...senderIconProps()}
            isDeleted={false}
            size="fill"
            suppressClick={true}
          />
        </div>
        <div class="min-w-0">
          <EmailUserTooltip recipient={props.message.from}>
            <span class="text-ink line-clamp-1">{senderDisplay()}</span>
          </EmailUserTooltip>
        </div>
      </div>
      <div data-slot="snippet" class="min-w-0 text-sm text-ink-extra-muted">
        {snippet()}
      </div>
      <Show when={props.message.internal_date_ts}>
        <span
          data-slot="date"
          class="macro-thread-message-header-row justify-self-end"
        >
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
