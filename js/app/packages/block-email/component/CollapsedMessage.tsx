import { UserIcon, type UserIconProps } from '@core/component/UserIcon';
import { useEmail } from '@core/context/user';
import type { ApiMessage } from '@service-email/generated/schemas';
import { createMemo, createSignal } from 'solid-js';
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
  const [hover, setHover] = createSignal(false);
  const [hasMouseLeft, setHasMouseLeft] = createSignal(false);
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
      <div class="macro-message-width macro-message-margin w-full pl-2 pr-4 sm:px-0">
        <div
          class="relative flex flex-row items-center w-full pb-2 transition-all"
          classList={{
            'pt-2': !props.isFirstMessage,
            'opacity-80': hasMouseLeft() && !hover(),
            'opacity-100': !hasMouseLeft() || hover(),
          }}
          data-message-body-id={props.message.db_id}
          tabIndex={0}
          onClick={props.onClick}
          onKeyDown={handleKeyDown}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => {
            setHover(false);
            setHasMouseLeft(true);
          }}
        >
          {/* Rail line - behind avatar */}
          <div
            class="absolute inset-y-0 border-l border-edge-muted z-0"
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
                'calc(var(--left-of-connector) - var(--user-icon-width) / 2 + 1px)',
            }}
          >
            <UserIcon
              {...senderIconProps()}
              isDeleted={false}
              size="fill"
              suppressClick={true}
            />
          </div>
          {/* Sender + Snippet - aligned with expanded message content */}
          <div
            class="flex-1 flex items-center min-w-0"
            style={{
              'padding-left': 'var(--message-padding-x)',
            }}
          >
            <span class="w-16 shrink-0">
              <EmailUserTooltip recipient={props.message.from}>
                <span class="text-ink font-semibold truncate text-sm cursor-default block">
                  {senderDisplay()}
                </span>
              </EmailUserTooltip>
            </span>
            <span class="text-ink truncate">{snippet()}</span>
          </div>
          {/* Date */}
          <div class="text-xs text-ink shrink-0 ml-4 pr-2">
            {props.message.internal_date_ts &&
              formatShortDate(props.message.internal_date_ts)}
          </div>
        </div>
      </div>
    </div>
  );
}
