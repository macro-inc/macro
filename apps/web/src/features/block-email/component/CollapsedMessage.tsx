import { UserIcon, type UserIconProps } from '@core/component/UserIcon';
import { useEmail } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { ApiMessage } from '@service-email/generated/schemas';
import { cn } from '@ui/utils/classname';
import { createMemo, Show } from 'solid-js';
import { getSenderDisplayName, getSenderMacroId } from '../util/emailUser';
import { formatShortDate } from './EmailMessageTopBar';
import { EmailUserTooltip } from './EmailUserTooltip';

interface CollapsedMessageProps {
  message: ApiMessage;
  isFocused: boolean;
  showBottomBorder?: boolean;
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

  return (
    <div class="shrink-0 flex justify-center w-full">
      <div class="macro-message-width macro-message-padding w-full">
        <div
          class={cn(
            'relative macro-thread-collapsed-row p-4 min-w-0 border border-transparent macro-thread-card-outdent',
            props.showBottomBorder && 'border-b-edge-muted',
            props.isFocused && !isTouchDevice() && 'bg-list-highlighted',
            !props.isFocused && !isTouchDevice() && 'hover:bg-list-hover'
          )}
          style={{
            '--user-icon-width': '1rem',
          }}
          data-message-body-id={props.message.db_id}
          tabIndex={0}
          onClick={props.onClick}
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
            <EmailUserTooltip recipient={props.message.from}>
              <span class="text-ink truncate cursor-default min-w-0">
                {senderDisplay()}
              </span>
            </EmailUserTooltip>
          </div>
          <div class="min-w-0 text-sm text-ink-extra-muted truncate">
            {snippet()}
          </div>
          <Show when={props.message.internal_date_ts}>
            <span class="justify-self-end text-sm text-ink-extra-muted/60 tabular-nums">
              {formatShortDate(props.message.internal_date_ts!)}
            </span>
          </Show>
        </div>
      </div>
    </div>
  );
}
