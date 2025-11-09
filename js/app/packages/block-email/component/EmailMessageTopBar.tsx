import { IconButton } from '@core/component/IconButton';
import { Tooltip } from '@core/component/Tooltip';
import { formatDate } from '@core/util/date';
import CaretDown from '@icon/regular/caret-down.svg';
import CaretUp from '@icon/regular/caret-up.svg';
import type { MessageWithBodyReplyless } from '@service-email/generated/schemas';
import { type Accessor, For, type Setter, Show } from 'solid-js';
import type { SetStoreFunction } from 'solid-js/store';
import { getFirstName } from '../util/name';
import { MessageActions } from './MessageActions';

interface EmailMessageTopBarProps {
  message: MessageWithBodyReplyless;
  focused: boolean;
  setExpandedMessageBodyIds: SetStoreFunction<Record<string, boolean>>;
  isBodyExpanded: Accessor<boolean>;
  expandedHeader: Accessor<boolean>;
  setExpandedHeader: Setter<boolean>;
  setFocusedMessageId: Setter<string | undefined>;
  setShowReply: Setter<boolean>;
  isLastMessage?: boolean;
}

export function EmailMessageTopBar(props: EmailMessageTopBarProps) {
  return (
    <div
      class="pr-2 font-mono"
      onPointerDown={(e) => {
        if (props.message.db_id) {
          props.setFocusedMessageId(props.message.db_id);
        }
        if (
          (e.target as Element).localName === 'button' ||
          (e.target as Element).localName === 'svg' ||
          (e.target as Element).localName === 'path' ||
          (e.target as Element).tagName === 'SPAN'
        )
          return;
        if (props.isBodyExpanded() && props.message.db_id) {
          props.setExpandedMessageBodyIds(props.message.db_id, false);
        } else if (props.message.db_id) {
          props.setExpandedMessageBodyIds(props.message.db_id, true);
        }
      }}
    >
      {/* Top Bar Main Row */}
      <div class={`flex flex-row w-full items-center justify-between`}>
        {/* Name and Email */}
        <div class="shrink-1 min-w-0 flex flex-row items-center text-sm gap-2">
          {/* Sender Name */}
          <div class="truncate text-ink-muted">
            {props.message.from?.name ?? props.message.from?.email}
          </div>
          {/* Sender Email */}
          <Show when={props.isBodyExpanded() && props.message.from?.name}>
            <div class="truncate flex-1 min-w-0 text-ink-muted text-xs">
              &lt;
              <span class="text-accent-ink select-text">
                {props.message.from?.email}
              </span>
              &gt;
            </div>
          </Show>
        </div>
        {/* Date and Actions */}
        <div class="flex flex-row gap-4 items-center">
          {/* Date */}
          <div class="text-xs text-ink-muted">
            {props.message.internal_date_ts &&
              formatDate(
                new Date(props.message.internal_date_ts).getTime() / 1000
              )}
          </div>
          <MessageActions
            message={props.message}
            showActions={props.focused}
            setShowReply={props.setShowReply}
            isLastMessage={props.isLastMessage}
          />
        </div>
      </div>
      {/* Recipient Fields */}
      <Show when={props.isBodyExpanded()}>
        <Show
          when={props.expandedHeader()}
          fallback={
            <div class="flex flex-row items-center gap-2 -mt-1">
              {/* normal one line TO, CC, BCC field */}
              <div class="text-xs select-text select-children cursor-text text-nowrap overflow-hidden">
                <span>to </span>
                <For each={props.message.to}>
                  {(t, index) => (
                    <Tooltip
                      tooltip={
                        <div class="text-xs select-text cursor-text">
                          {t.email}
                        </div>
                      }
                      class="inline"
                    >
                      <span>
                        {(t.name ? getFirstName(t.name) : t.email) +
                          (index() < props.message.to.length - 1 ||
                          props.message.cc.length > 0
                            ? ', '
                            : '')}
                      </span>
                    </Tooltip>
                  )}
                </For>
                <For each={props.message.cc}>
                  {(t, index) => (
                    <Tooltip
                      tooltip={
                        <div class="text-xs select-text cursor-text">
                          {t.email}
                        </div>
                      }
                      class="inline"
                    >
                      <span>
                        {(t.name ? getFirstName(t.name) : t.email) +
                          (index() < props.message.cc.length - 1 ? ', ' : '')}
                      </span>
                    </Tooltip>
                  )}
                </For>
                <Show when={props.message.bcc.length > 0}>, bcc: </Show>
                <For each={props.message.bcc}>
                  {(t, index) => (
                    <Tooltip
                      tooltip={
                        <div class="text-xs select-text cursor-text">
                          {t.email}
                        </div>
                      }
                      class="inline"
                    >
                      <span>
                        {(t.name ? getFirstName(t.name) : t.email) +
                          (index() < props.message.bcc.length - 1 ? ', ' : '')}
                      </span>
                    </Tooltip>
                  )}
                </For>
              </div>
              {/* Expand Header Button */}
              <IconButton
                theme="clear"
                icon={CaretDown}
                onclick={() => {
                  props.setExpandedHeader(true);
                }}
                iconSize={12}
                class="h-[17px]!"
              />
            </div>
          }
        >
          {/* Expanded TO */}
          <Show when={props.message.to.length > 0}>
            <div class="flex flex-row items-start gap-2 text-sm">
              <span class="text-ink-extra-muted min-w-7">to</span>
              <div class="text-sm select-text cursor-text">
                <For each={props.message.to}>
                  {(t, index) => (
                    <Tooltip
                      tooltip={
                        <div class="text-xs select-text cursor-text">
                          {t.email}
                        </div>
                      }
                      class="inline"
                    >
                      <span class="select-text">
                        {(t.name ? getFirstName(t.name) : t.email) +
                          (index() < props.message.to.length - 1 ? ', ' : '')}
                      </span>
                    </Tooltip>
                  )}
                </For>
                {/* Expand Header Button */}

                <Show
                  when={
                    props.message.cc.length === 0 &&
                    props.message.bcc.length === 0
                  }
                >
                  <IconButton
                    theme="clear"
                    icon={CaretUp}
                    onclick={() => {
                      props.setExpandedHeader(false);
                    }}
                    iconSize={12}
                    class="h-[17px]! pl-2! inline-block!"
                  />
                </Show>
              </div>
            </div>
          </Show>
          {/* Expanded CC */}
          <Show when={props.message.cc.length > 0}>
            <div class="flex flex-row items-start gap-2 text-sm">
              <span class="text-ink-extra-muted min-w-7">cc</span>
              <div class="text-sm select-text cursor-text">
                <For each={props.message.cc}>
                  {(t, index) => (
                    <Tooltip
                      tooltip={
                        <div class="text-xs select-text cursor-text">
                          {t.email}
                        </div>
                      }
                      class="inline"
                    >
                      <span class="select-text">
                        {(t.name ? getFirstName(t.name) : t.email) +
                          (index() < props.message.cc.length - 1 ? ', ' : '')}
                      </span>
                    </Tooltip>
                  )}
                </For>
                {/* Expand Header Button */}

                <Show when={props.message.bcc.length === 0}>
                  <IconButton
                    theme="clear"
                    icon={CaretUp}
                    onclick={() => {
                      props.setExpandedHeader(false);
                    }}
                    iconSize={12}
                    class="h-[17px]! pl-2! inline-block!"
                  />
                </Show>
              </div>
            </div>
          </Show>
          {/* bcc */}
          <Show when={props.message.bcc.length > 0}>
            <div class="flex flex-row items-start gap-2 text-sm">
              <span class="text-ink-extra-muted min-w-7">bcc</span>
              <div class="text-sm select-text cursor-text">
                <For each={props.message.bcc}>
                  {(t, index) => (
                    <Tooltip
                      tooltip={
                        <div class="text-xs select-text cursor-text">
                          {t.email}
                        </div>
                      }
                      class="inline"
                    >
                      <span class="select-text">
                        {(t.name ? getFirstName(t.name) : t.email) +
                          (index() < props.message.bcc.length - 1 ? ', ' : '')}
                      </span>
                    </Tooltip>
                  )}
                </For>
                {/* Expand Header Button */}

                <IconButton
                  theme="clear"
                  icon={CaretUp}
                  onclick={() => {
                    props.setExpandedHeader(false);
                  }}
                  iconSize={12}
                  class="h-[17px]! pl-2! inline-block!"
                />
              </div>
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
