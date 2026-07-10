import { UserIcon, type UserIconProps } from '@core/component/UserIcon';
import { useEmail } from '@core/context/user';
import type { ApiMessage } from '@service-email/generated/schemas';
import { cn } from '@ui/utils/classname';
import { createMemo, For, Show } from 'solid-js';
import {
  getRecipientDisplayName,
  getSenderDisplayName,
  getSenderMacroId,
} from '../util/emailUser';
import { formatShortDate } from './EmailMessageTopBar';
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
  const allRecipients = createMemo(() => [
    ...props.message.to,
    ...props.message.cc,
  ]);
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
            'relative flex flex-col gap-2 p-4 rounded-lg min-w-0 ring',
            props.isFocused
              ? 'bg-active/60 ring-edge'
              : 'bg-ink-muted/2.5 hover:bg-active/40 hover:ring-edge ring-transparent'
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
          <div class="flex items-center gap-2 min-w-0 text-xs">
            <div class="shrink-0 flex justify-center items-center size-6">
              <UserIcon
                {...senderIconProps()}
                isDeleted={false}
                size="fill"
                suppressClick={true}
              />
            </div>
            <EmailUserTooltip recipient={props.message.from}>
              <span class="text-ink truncate cursor-default shrink-0 max-w-32">
                {senderDisplay()}
              </span>
            </EmailUserTooltip>
            <Show when={props.message.internal_date_ts}>
              <span class="shrink-0 text-ink-extra-muted/60 tabular-nums">
                {formatShortDate(props.message.internal_date_ts!)}
              </span>
            </Show>
          </div>
          <div class="min-w-0 text-sm text-ink-muted truncate">
            {snippet()}
          </div>
        </div>
      </div>
    </div>
  );
}
