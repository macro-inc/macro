import { useEmail } from '@core/context/user';
import type { DateValue } from '@core/util/date';
import CaretDown from '@icon/caret-down.svg';
import CaretUp from '@icon/caret-up.svg';
import type { ApiMessage } from '@service-email/generated/schemas';
import { Button, Tooltip } from '@ui';
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
} from '../util/emailUser';
import { useEmailContext } from './EmailContext';
import { EmailUserTooltip } from './EmailUserTooltip';
import { type EmailMessageAction, MessageActions } from './MessageActions';

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

function RecipientChip(props: { recipient: Recipient }): JSX.Element {
  return (
    <EmailUserTooltip recipient={props.recipient}>
      <span class="cursor-default whitespace-nowrap">
        <span class="text-ink">
          {props.recipient.name ?? props.recipient.email}
        </span>
        <Show when={props.recipient.name && props.recipient.email}>
          <span class="text-ink-extra-muted ml-1.5">
            {props.recipient.email}
          </span>
        </Show>
      </span>
    </EmailUserTooltip>
  );
}

function DetailRow(props: {
  label: string;
  recipients: Recipient[];
}): JSX.Element {
  return (
    <Show when={props.recipients.length > 0}>
      <div class="flex flex-row gap-3 text-sm">
        <span class="text-ink-extra-muted shrink-0 w-10 text-sm pt-0.5">
          {props.label}
        </span>
        <div class="flex flex-row flex-wrap gap-y-1 select-text cursor-text min-w-0">
          <For each={props.recipients}>
            {(r, index) => (
              <>
                <RecipientChip recipient={r} />
                <Show when={index() < props.recipients.length - 1}>
                  <span class="text-ink-extra-muted mr-2">,</span>
                </Show>
              </>
            )}
          </For>
        </div>
      </div>
    </Show>
  );
}

function ExpandedDetails(props: { message: ApiMessage }): JSX.Element {
  const fromRecipients = createMemo(() =>
    props.message.from ? [props.message.from] : []
  );

  return (
    <div class="mt-2.5 py-3 border-y border-ink-muted/8 flex flex-col gap-1.5 text-sm">
      <DetailRow label="From" recipients={fromRecipients()} />
      <DetailRow label="To" recipients={props.message.to} />
      <DetailRow label="Cc" recipients={props.message.cc} />
      <DetailRow label="Bcc" recipients={props.message.bcc} />
      <Show when={props.message.internal_date_ts}>
        <div class="text-xs text-ink-extra-muted tabular-nums mt-1.5 select-text cursor-text">
          {formatFullDate(props.message.internal_date_ts!)}
        </div>
      </Show>
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

function HeaderTopRow(props: {
  senderName: string;
  isHovering: boolean;
  isExpanded: boolean;
  onToggle: () => void;
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
      <div class="flex flex-row items-center gap-1.5 text-sm min-w-0">
        <EmailUserTooltip recipient={props.message.from}>
          <span class="text-ink font-medium cursor-default">
            {props.senderName}
          </span>
        </EmailUserTooltip>
        <span class="text-ink-extra-muted text-sm truncate">
          to{' '}
          <CollapsedRecipientList
            recipients={allRecipients()}
            currentUserEmail={props.currentUserEmail}
          />
        </span>
        <div
          classList={{
            'opacity-0': !props.isHovering && !props.isExpanded,
            'opacity-100': props.isHovering || props.isExpanded,
          }}
        >
          <Tooltip
            label={
              props.isExpanded
                ? 'Collapse Message Header'
                : 'Expand Message Header'
            }
          >
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={(e) => {
                e.stopPropagation();
                props.onToggle();
              }}
            >
              <Show when={props.isExpanded} fallback={<CaretDown />}>
                <CaretUp />
              </Show>
            </Button>
          </Tooltip>
        </div>
      </div>
      <div class="flex flex-row gap-3 items-center shrink-0">
        <MessageActions
          message={props.message}
          showActions={props.focused}
          setShowReply={props.setShowReply}
          isLastMessage={props.isLastMessage}
          hiddenActions={props.hiddenActions}
        />
        <Show when={props.message.internal_date_ts}>
          <Tooltip label={formatFullDate(props.message.internal_date_ts!)}>
            <div class="text-xs text-ink-extra-muted tabular-nums cursor-default">
              {formatShortDate(props.message.internal_date_ts!)}
            </div>
          </Tooltip>
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
      class="ph-no-capture pr-1.5 flex flex-col w-full"
      style={{ 'min-height': 'var(--user-icon-width)' }}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onClick={handleClick}
    >
      <Show when={props.isBodyExpanded()}>
        <div
          class="flex items-center"
          style={{ 'min-height': 'var(--user-icon-width)' }}
        >
          <HeaderTopRow
            senderName={senderName()}
            isHovering={isHovering()}
            isExpanded={props.expandedHeader()}
            onToggle={() => toggleExpandedHeader(!props.expandedHeader())}
            message={props.message}
            focused={props.focused}
            setShowReply={props.setShowReply}
            isLastMessage={props.isLastMessage}
            hiddenActions={props.hiddenActions}
            currentUserEmail={userEmail()}
          />
        </div>
        <Show when={props.expandedHeader()}>
          <ExpandedDetails message={props.message} />
        </Show>
      </Show>
    </div>
  );
}
