import { DeprecatedIconButton } from '@core/component/DeprecatedIconButton';
import { Tooltip } from '@core/component/Tooltip';
import { EmailUserTooltip } from './EmailUserTooltip';
import CaretDown from '@icon/regular/caret-down.svg';
import CaretUp from '@icon/regular/caret-up.svg';
import type { ApiMessage } from '@service-email/generated/schemas';
import { useEmail } from '@core/context/user';
import {
  type Accessor,
  createMemo,
  createSignal,
  For,
  type JSX,
  type Setter,
  Show,
} from 'solid-js';
import {
  getRecipientDisplayName,
  getSenderDisplayName,
  isMessageFromCurrentUser,
} from '../util/emailUser';
import { useEmailContext } from './EmailContext';
import { type EmailMessageAction, MessageActions } from './MessageActions';
import type { DateValue } from '@core/util/date';

interface EmailMessageTopBarProps {
  message: ApiMessage;
  focused: boolean;
  setExpandedBodyId: (id: string, expanded: boolean) => void;
  isBodyExpanded: Accessor<boolean>;
  expandedHeader: Accessor<boolean>;
  setExpandedHeader: Setter<boolean>;
  setFocusedMessageId: (messageId: string | undefined) => void;
  setShowReply: Setter<boolean>;
  isLastMessage?: boolean;
  hiddenActions?: EmailMessageAction[];
}

interface Recipient {
  name?: string | null;
  email?: string | null;
}

function formatFullDate(date: DateValue): string {
  return new Date(date)
    .toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    })
    .replace(',', '');
}

export function formatShortDate(date: DateValue): string {
  const d = new Date(date);
  if (d.getFullYear() !== new Date().getFullYear()) {
    return d.toLocaleDateString('en-US', {
      month: 'numeric',
      day: 'numeric',
      year: '2-digit',
    });
  }
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function RecipientRow(props: {
  label: string;
  recipients: Recipient[];
  bold?: boolean;
}): JSX.Element {
  return (
    <Show when={props.recipients.length > 0}>
      <div class="flex flex-row gap-2">
        <span class="text-ink-extra-muted min-w-10">{props.label}</span>
        <span class="select-text cursor-text">
          <For each={props.recipients}>
            {(r, index) => (
              <>
                <EmailUserTooltip recipient={r}>
                  <span
                    classList={{
                      'font-semibold': props.bold,
                      'text-ink': true,
                      'cursor-default': true,
                    }}
                  >
                    {r.name ?? r.email}
                    <Show when={r.name && r.email}>
                      <span class="text-ink-muted"> &lt;{r.email}&gt;</span>
                    </Show>
                  </span>
                </EmailUserTooltip>
                <Show when={index() < props.recipients.length - 1}>
                  <span class="text-ink-muted">, </span>
                </Show>
              </>
            )}
          </For>
        </span>
      </div>
    </Show>
  );
}

function ExpandedHeader(props: {
  message: ApiMessage;
  onClose: () => void;
}): JSX.Element {
  return (
    <div class="flex flex-col gap-1 text-sm select-children cursor-text">
      <div class="flex flex-row gap-2">
        <span class="text-ink-extra-muted min-w-10">From</span>
        <span class="select-text cursor-text">
          <EmailUserTooltip recipient={props.message.from}>
            <span class="font-semibold text-ink cursor-default">
              {props.message.from?.name ?? props.message.from?.email}
              <Show
                when={props.message.from?.name && props.message.from?.email}
              >
                <span class="text-ink-muted">
                  {' '}
                  &lt;{props.message.from?.email}&gt;
                </span>
              </Show>
            </span>
          </EmailUserTooltip>
        </span>
      </div>
      <RecipientRow label="To" recipients={props.message.to} />
      <RecipientRow label="Cc" recipients={props.message.cc} bold />
      <RecipientRow label="Bcc" recipients={props.message.bcc} bold />
      <div class="flex flex-row items-center gap-2 text-ink-extra-muted">
        <Show when={props.message.internal_date_ts}>
          <span>{formatFullDate(props.message.internal_date_ts!)}</span>
        </Show>
        <DeprecatedIconButton
          theme="clear"
          icon={CaretUp}
          onclick={props.onClose}
          iconSize={12}
        />
      </div>
    </div>
  );
}

function CollapsedRecipientList(props: {
  recipients: Recipient[];
  currentUserEmail?: string;
}): JSX.Element {
  return (
    <For each={props.recipients}>
      {(r, index) => {
        const displayName = () =>
          getRecipientDisplayName(r, props.currentUserEmail);
        const isLast = () => index() === props.recipients.length - 1;
        const isSecondToLast = () => index() === props.recipients.length - 2;
        return (
          <>
            <EmailUserTooltip recipient={r}>
              <span class="cursor-default">{displayName()}</span>
            </EmailUserTooltip>
            <Show when={!isLast()}>
              <span>{isSecondToLast() ? ' & ' : ', '}</span>
            </Show>
          </>
        );
      }}
    </For>
  );
}

function CollapsedHeader(props: {
  senderName: string;
  isHovering: boolean;
  onExpand: () => void;
  message: ApiMessage;
  focused: boolean;
  setShowReply: Setter<boolean>;
  isLastMessage?: boolean;
  hiddenActions?: EmailMessageAction[];
  currentUserEmail?: string;
}): JSX.Element {
  const allRecipients = createMemo(() => [
    ...props.message.to,
    ...props.message.cc,
  ]);

  return (
    <div class="flex flex-row w-full items-center justify-between">
      <div class="flex flex-row items-center gap-1 text-sm min-w-0">
        <span class="text-ink font-semibold truncate">
          <EmailUserTooltip recipient={props.message.from}>
            <span class="cursor-default">{props.senderName}</span>
          </EmailUserTooltip>
          <span style={{ padding: '0 0.275em' }}>to</span>
          <CollapsedRecipientList
            recipients={allRecipients()}
            currentUserEmail={props.currentUserEmail}
          />
        </span>
        <div
          class="transition-opacity"
          classList={{
            'opacity-0': !props.isHovering,
            'opacity-100': props.isHovering,
          }}
        >
          <Tooltip tooltip={<span class="text-xs">Expand Message Header</span>}>
            <DeprecatedIconButton
              theme="clear"
              icon={CaretDown}
              onclick={(e) => {
                e.stopPropagation();
                props.onExpand();
              }}
              iconSize={12}
            />
          </Tooltip>
        </div>
      </div>
      <div class="flex flex-row gap-4 items-center shrink-0">
        <MessageActions
          message={props.message}
          showActions={props.focused}
          setShowReply={props.setShowReply}
          isLastMessage={props.isLastMessage}
          hiddenActions={props.hiddenActions}
        />
        <Show when={props.message.internal_date_ts}>
          <div class="text-xs text-ink">
            {formatShortDate(props.message.internal_date_ts!)}
          </div>
        </Show>
      </div>
    </div>
  );
}

export function EmailMessageTopBar(props: EmailMessageTopBarProps) {
  const [isHovering, setIsHovering] = createSignal(false);
  const userEmail = useEmail();
  const context = useEmailContext();

  // Wraps setExpandedHeader with scroll compensation.
  // The message list uses flex-col-reverse, so expanding the header
  // shifts content above upward. This adjusts scrollTop to keep the
  // visual position stable.
  const toggleExpandedHeader = (expanded: boolean) => {
    const scrollContainer = context.messagesListRef();
    if (!scrollContainer) {
      props.setExpandedHeader(expanded);
      return;
    }
    const prevScrollHeight = scrollContainer.scrollHeight;
    const prevScrollTop = scrollContainer.scrollTop;
    props.setExpandedHeader(expanded);
    requestAnimationFrame(() => {
      const delta = scrollContainer.scrollHeight - prevScrollHeight;
      scrollContainer.scrollTop = prevScrollTop - delta;
    });
  };

  const _isFromCurrentUser = createMemo(() =>
    isMessageFromCurrentUser(props.message, userEmail())
  );

  const senderName = createMemo(() =>
    getSenderDisplayName(props.message, userEmail())
  );

  const shouldIgnoreClick = (target: Element) =>
    target.localName === 'button' ||
    target.localName === 'svg' ||
    target.localName === 'path' ||
    target.tagName === 'SPAN' ||
    target.closest('[role="tooltip"]');

  const handleClick = (e: MouseEvent) => {
    const id = props.message.db_id;
    if (id) props.setFocusedMessageId(id);
    if (shouldIgnoreClick(e.target as Element)) return;
    if (id) props.setExpandedBodyId(id, !props.isBodyExpanded());
  };

  return (
    <div
      class="pr-2 flex items-center -mt-1 sm:mt-0"
      style={{ 'min-height': 'var(--user-icon-width)' }}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onClick={handleClick}
    >
      <Show when={props.isBodyExpanded()}>
        <Show
          when={!props.expandedHeader()}
          fallback={
            <ExpandedHeader
              message={props.message}
              onClose={() => toggleExpandedHeader(false)}
            />
          }
        >
          <CollapsedHeader
            senderName={senderName()}
            isHovering={isHovering()}
            onExpand={() => toggleExpandedHeader(true)}
            message={props.message}
            focused={props.focused}
            setShowReply={props.setShowReply}
            isLastMessage={props.isLastMessage}
            hiddenActions={props.hiddenActions}
            currentUserEmail={userEmail()}
          />
        </Show>
      </Show>
    </div>
  );
}
