import { UserIcon, type UserIconProps } from '@core/component/UserIcon';
import { useEmail } from '@core/context/user';
import type { ApiMessage } from '@service-email/generated/schemas';
import { cn, Tooltip } from '@ui';
import { createMemo, Show } from 'solid-js';
import { getSenderDisplayName, getSenderMacroId } from '../util/emailUser';
import { formatFullDate, formatShortDate } from './EmailMessageTopBar';
import { EmailUserTooltip } from './EmailUserTooltip';

interface CollapsedMessageProps {
  message: ApiMessage;
  isFocused: boolean;
  onClick: () => void;
  onFocus?: () => void;
}

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

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      props.onClick();
    }
  };

  const handleRowClick = (e: MouseEvent) => {
    const target = e.target;
    if (
      target instanceof Element &&
      target.closest('[data-button], a[href]')
    ) {
      return;
    }
    props.onClick();
  };

  return (
    <div class="shrink-0 flex justify-center w-full">
      <div class="macro-message-width macro-message-padding w-full">
        <div
          class={cn(
            'relative macro-thread-collapsed-row p-4 min-w-0 border bg-surface cursor-pointer macro-thread-card-outdent',
            props.isFocused
              ? 'z-1 border-edge shadow-md shadow-drop-shadow'
              : 'border-edge-muted'
          )}
          style={{
            '--user-icon-width': '1rem',
          }}
          data-message-body-id={props.message.db_id}
          tabIndex={0}
          onClick={handleRowClick}
          onClickCapture={handleRowClick}
          onFocus={props.onFocus}
          onKeyDown={handleKeyDown}
        >
          <div class="flex items-center gap-2 min-w-0 text-sm">
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
          <div class="min-w-0 text-sm text-ink-extra-muted truncate">
            {snippet()}
          </div>
          <Show when={props.message.internal_date_ts}>
            <Tooltip
              as="span"
              class="justify-self-end"
              label={formatFullDate(props.message.internal_date_ts!)}
            >
              <span class="text-sm text-ink-extra-muted/60 tabular-nums">
                {formatShortDate(props.message.internal_date_ts!)}
              </span>
            </Tooltip>
          </Show>
        </div>
      </div>
    </div>
  );
}
