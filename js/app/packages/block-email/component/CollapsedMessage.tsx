import { BozzyBracket } from '@core/component/BozzyBracket';
import { UserIcon } from '@core/component/UserIcon';
import type { MessageWithBodyReplyless } from '@service-email/generated/schemas';
import { useEmail, useUserId } from '@queries/auth/user-info';
import { createMemo, createSignal } from 'solid-js';
import {
  getSenderDisplayName,
  isMessageFromCurrentUser,
} from '../util/emailUser';

interface CollapsedMessageProps {
  message: MessageWithBodyReplyless;
  isFocused: boolean;
  onClick: () => void;
}

export function CollapsedMessage(props: CollapsedMessageProps) {
  const [hover, setHover] = createSignal(false);
  const currentUserEmail = useEmail();
  const currentUserId = useUserId();

  const isFromCurrentUser = createMemo(() =>
    isMessageFromCurrentUser(props.message, currentUserEmail())
  );

  const senderDisplay = createMemo(() =>
    getSenderDisplayName(props.message, currentUserEmail())
  );

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

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      props.onClick();
    }
  };

  return (
    <div class="shrink-0 flex justify-center w-full">
      {/* These pl/pr below are needed to align with expanded messages at mobile width. */}
      <div class="macro-message-width w-full pl-2 pr-4 sm:px-0">
        <BozzyBracket active={props.isFocused} hover={hover()} class="">
          <div
            class="relative flex flex-row items-center w-full py-2 cursor-pointer opacity-60 hover:opacity-100 transition-all"
            data-message-body-id={props.message.db_id}
            tabIndex={0}
            onClick={props.onClick}
            onKeyDown={handleKeyDown}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
          >
            {/* Rail line - behind avatar */}
            <div
              class="absolute top-0 bottom-0 border-l border-edge-muted z-0"
              style={{
                left: 'var(--left-of-connector)',
              }}
            />
            {/* Avatar - centered on the rail, in front of rail */}
            <div
              class="relative z-10 flex justify-center items-center shrink-0"
              style={{
                width: 'var(--user-icon-width)',
                height: 'var(--user-icon-width)',
                'margin-left':
                  'calc(var(--left-of-connector) - var(--user-icon-width) / 2)',
              }}
            >
              <UserIcon
                {...(isFromCurrentUser()
                  ? { id: currentUserId() ?? '' }
                  : { email: props.message.from?.email ?? '' })}
                isDeleted={false}
                size="fill"
                suppressClick={true}
              />
            </div>
            {/* Sender + Snippet - aligned with expanded message content */}
            <div
              class="flex-1 flex items-center min-w-0"
              style={{
                'padding-left':
                  'calc(var(--left-of-connector) - var(--user-icon-width) / 2)',
              }}
            >
              <span class="text-ink-muted w-16 shrink-0 truncate">
                {senderDisplay()}
              </span>
              <span class="text-ink-extra-muted truncate">{snippet()}</span>
            </div>
            {/* Date */}
            <div class="text-xs touch:mobile-width:text-sm text-ink-muted shrink-0 ml-4 pr-2">
              {props.message.internal_date_ts &&
                new Date(props.message.internal_date_ts).toLocaleDateString(
                  'en-US',
                  {
                    month: 'short',
                    day: 'numeric',
                  }
                )}
            </div>
          </div>
        </BozzyBracket>
      </div>
    </div>
  );
}
