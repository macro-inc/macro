import { DeprecatedIconButton } from '@core/component/DeprecatedIconButton';
import { Tooltip } from '@core/component/Tooltip';
import CaretDown from '@icon/regular/caret-down.svg';
import X from '@icon/regular/x.svg';
import type { MessageWithBodyReplyless } from '@service-email/generated/schemas';
import { useEmail } from '@service-gql/client';
import {
  type Accessor,
  createMemo,
  createSignal,
  For,
  type Setter,
  Show,
} from 'solid-js';
import { getFirstName } from '../util/name';
import { type EmailMessageAction, MessageActions } from './MessageActions';

interface EmailMessageTopBarProps {
  message: MessageWithBodyReplyless;
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

/**
 * Formats a date for the expanded header view
 * e.g., "Friday, January 9 2026 at 1:50 PM EST"
 */
function formatFullDate(timestamp: string): string {
  const date = new Date(timestamp);
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  };
  return date.toLocaleString('en-US', options).replace(',', '').replace(' at', ' at');
}

export function EmailMessageTopBar(props: EmailMessageTopBarProps) {
  const [isHovering, setIsHovering] = createSignal(false);
  const userEmail = useEmail();

  // Check if sender is current user
  const isFromCurrentUser = createMemo(() => {
    const fromEmail = props.message.from?.email?.toLowerCase();
    const currentEmail = userEmail()?.toLowerCase();
    return fromEmail && currentEmail && fromEmail === currentEmail;
  });

  // Get sender first name (show "Me" if from current user)
  const senderName = createMemo(() => {
    if (isFromCurrentUser()) {
      return 'Me';
    }
    const from = props.message.from;
    if (!from) return 'Unknown';
    return from.name ? getFirstName(from.name) : from.email?.split('@')[0] ?? 'Unknown';
  });

  // Build recipient summary: "Me, Jackson & Will" style
  const recipientSummary = createMemo(() => {
    const recipients: string[] = [];
    const currentEmail = userEmail();

    // Add To recipients
    for (const r of props.message.to) {
      if (r.email === currentEmail) {
        recipients.push('Me');
      } else {
        recipients.push(r.name ? getFirstName(r.name) : r.email?.split('@')[0] ?? '');
      }
    }

    // Add Cc recipients
    for (const r of props.message.cc) {
      if (r.email === currentEmail) {
        recipients.push('Me');
      } else {
        recipients.push(r.name ? getFirstName(r.name) : r.email?.split('@')[0] ?? '');
      }
    }

    if (recipients.length === 0) return '';
    if (recipients.length === 1) return recipients[0];
    if (recipients.length === 2) return `${recipients[0]} & ${recipients[1]}`;

    // For 3+: "A, B & C"
    const last = recipients.pop();
    return `${recipients.join(', ')} & ${last}`;
  });

  return (
    <div
      class="pr-2 font-mono"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onClick={(e) => {
        if (props.message.db_id) {
          props.setFocusedMessageId(props.message.db_id);
        }
        if (
          (e.target as Element).localName === 'button' ||
          (e.target as Element).localName === 'svg' ||
          (e.target as Element).localName === 'path' ||
          (e.target as Element).tagName === 'SPAN' ||
          (e.target as Element).closest('[role="tooltip"]')
        ) {
          return;
        }
        if (props.isBodyExpanded() && props.message.db_id) {
          props.setExpandedBodyId(props.message.db_id, false);
        } else if (props.message.db_id) {
          props.setExpandedBodyId(props.message.db_id, true);
        }
      }}
    >
      {/* Main Row - always visible when body is expanded */}
      <Show when={props.isBodyExpanded()}>
        <Show
          when={!props.expandedHeader()}
          fallback={
            /* Expanded Header View */
            <div class="flex flex-col gap-1 text-sm">
              {/* From */}
              <div class="flex flex-row gap-2">
                <span class="text-ink-extra-muted min-w-10">From</span>
                <span class="select-text cursor-text">
                  <span class="font-semibold text-ink">
                    {props.message.from?.name ?? props.message.from?.email}
                  </span>
                  <Show when={props.message.from?.name && props.message.from?.email}>
                    <span class="text-ink-muted">
                      {' '}&lt;{props.message.from?.email}&gt;
                    </span>
                  </Show>
                </span>
              </div>

              {/* To */}
              <Show when={props.message.to.length > 0}>
                <div class="flex flex-row gap-2">
                  <span class="text-ink-extra-muted min-w-10">To</span>
                  <span class="select-text cursor-text">
                    <For each={props.message.to}>
                      {(r, index) => (
                        <>
                          <span class="text-ink">{r.name ?? r.email}</span>
                          <Show when={r.name && r.email}>
                            <span class="text-ink-muted"> &lt;{r.email}&gt;</span>
                          </Show>
                          <Show when={index() < props.message.to.length - 1}>
                            <span class="text-ink-muted">, </span>
                          </Show>
                        </>
                      )}
                    </For>
                  </span>
                </div>
              </Show>

              {/* Cc */}
              <Show when={props.message.cc.length > 0}>
                <div class="flex flex-row gap-2">
                  <span class="text-ink-extra-muted min-w-10">Cc</span>
                  <span class="select-text cursor-text">
                    <For each={props.message.cc}>
                      {(r, index) => (
                        <>
                          <span class="font-semibold text-ink">{r.name ?? r.email}</span>
                          <Show when={r.name && r.email}>
                            <span class="text-ink-muted"> &lt;{r.email}&gt;</span>
                          </Show>
                          <Show when={index() < props.message.cc.length - 1}>
                            <span class="text-ink-muted">, </span>
                          </Show>
                        </>
                      )}
                    </For>
                  </span>
                </div>
              </Show>

              {/* Bcc */}
              <Show when={props.message.bcc.length > 0}>
                <div class="flex flex-row gap-2">
                  <span class="text-ink-extra-muted min-w-10">Bcc</span>
                  <span class="select-text cursor-text">
                    <For each={props.message.bcc}>
                      {(r, index) => (
                        <>
                          <span class="font-semibold text-ink">{r.name ?? r.email}</span>
                          <Show when={r.name && r.email}>
                            <span class="text-ink-muted"> &lt;{r.email}&gt;</span>
                          </Show>
                          <Show when={index() < props.message.bcc.length - 1}>
                            <span class="text-ink-muted">, </span>
                          </Show>
                        </>
                      )}
                    </For>
                  </span>
                </div>
              </Show>

              {/* Date with close button */}
              <div class="flex flex-row items-center gap-2 text-ink-extra-muted">
                <Show when={props.message.internal_date_ts}>
                  <span>{formatFullDate(props.message.internal_date_ts!)}</span>
                </Show>
                <DeprecatedIconButton
                  theme="clear"
                  icon={X}
                  onclick={() => props.setExpandedHeader(false)}
                  iconSize={12}
                />
              </div>
            </div>
          }
        >
          {/* Collapsed Header View - Superhuman style */}
          <div class="flex flex-row w-full items-center justify-between">
            <div class="flex flex-row items-center gap-1 text-sm min-w-0">
              {/* "Sender to Recipients" */}
              <span class="text-ink-muted truncate">
                {senderName()} to {recipientSummary()}
              </span>
              {/* Expand button - show on hover */}
              <div
                class="transition-opacity"
                classList={{
                  'opacity-0': !isHovering(),
                  'opacity-100': isHovering(),
                }}
              >
                <Tooltip
                  tooltip={
                    <div class="flex items-center gap-2 text-xs">
                      <span>Expand Message Header</span>
                    </div>
                  }
                >
                  <DeprecatedIconButton
                    theme="clear"
                    icon={CaretDown}
                    onclick={(e) => {
                      e.stopPropagation();
                      props.setExpandedHeader(true);
                    }}
                    iconSize={12}
                  />
                </Tooltip>
              </div>
            </div>
            {/* Actions and Date */}
            <div class="flex flex-row gap-4 items-center shrink-0">
              <MessageActions
                message={props.message}
                showActions={props.focused}
                setShowReply={props.setShowReply}
                isLastMessage={props.isLastMessage}
                hiddenActions={props.hiddenActions}
              />
              {/* Date */}
              <div class="text-xs text-ink-muted">
                {props.message.internal_date_ts &&
                  new Date(props.message.internal_date_ts).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })}
              </div>
            </div>
          </div>
        </Show>
      </Show>
    </div>
  );
}
