import { UserIcon, type UserIconProps } from '@core/component/UserIcon';
import { useEmail } from '@core/context/user';
import type { ApiMessage } from '@service-email/generated/schemas';
import { cn } from '@ui/utils/classname';
import { createMemo } from 'solid-js';
import { getSenderDisplayName, getSenderMacroId } from '../util/emailUser';
import { formatShortDate } from './EmailMessageTopBar';
import { EmailUserTooltip } from './EmailUserTooltip';

interface CollapsedMessageProps {
  message: ApiMessage;
  isFocused: boolean;
  isFirstMessage: boolean;
  onClick: () => void;
}

export function CollapsedMessage(props: CollapsedMessageProps) {
  const currentUserEmail = useEmail();

  const senderDisplay = createMemo(() =>
    getSenderDisplayName(props.message, currentUserEmail())
  );
  const senderMacroId = createMemo(() => getSenderMacroId(props.message));
  const senderIconProps = createMemo<UserIconProps>(() => {
    const senderId = senderMacroId();
    if (senderId) return { id: senderId };
    return { email: props.message.from?.email ?? '' };
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
      props.onClick();
    }
  };

  return (
    <div class="shrink-0 flex justify-center w-full">
      <div class="macro-message-width macro-message-padding w-full">
        <div
          class={cn(
            'group/msg flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-ink-muted/8 bg-ink-muted/[0.025] cursor-pointer min-w-0',
            props.isFocused
              ? 'bg-ink-muted/[0.06]'
              : 'hover:bg-ink-muted/[0.06]'
          )}
          data-message-body-id={props.message.db_id}
          tabIndex={0}
          onClick={props.onClick}
          onKeyDown={handleKeyDown}
        >
          <div
            class="shrink-0 flex justify-center items-center"
            style={{
              width: 'var(--user-icon-width)',
              height: 'var(--user-icon-width)',
            }}
          >
            <UserIcon
              {...senderIconProps()}
              isDeleted={false}
              size="fill"
              suppressClick={true}
            />
          </div>
          <div class="shrink-0 min-w-0 max-w-28">
            <EmailUserTooltip recipient={props.message.from}>
              <div
                class={cn(
                  'text-sm truncate cursor-default',
                  props.isFocused ? 'text-ink font-medium' : 'text-ink font-medium'
                )}
              >
                {senderDisplay()}
              </div>
            </EmailUserTooltip>
          </div>
          <div class="flex-1 min-w-0 text-sm text-ink-muted/60 truncate">
            {snippet()}
          </div>
          <div class="shrink-0 text-xs text-ink-extra-muted tabular-nums">
            {props.message.internal_date_ts &&
              formatShortDate(props.message.internal_date_ts)}
          </div>
        </div>
      </div>
    </div>
  );
}
