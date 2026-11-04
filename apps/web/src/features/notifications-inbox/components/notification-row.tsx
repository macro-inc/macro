import { t } from '@app/lib/i18n';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import {
  twoLineClampMarkdownTheme,
  unifiedListMarkdownTheme,
} from '@core/component/LexicalMarkdown/theme';
import CheckIcon from '@icon/system/regular/check.svg';
import { Button, cn } from '@ui';
import { For, type JSX, Show } from 'solid-js';
import type { InboxStackItem } from '../core/inbox-row';

export type NotificationRowProps = {
  /** The row's element id, for `aria-activedescendant`. */
  id: string;
  /** What the card is about: a subject, message, channel or document. */
  title: string;
  /** Who did what. */
  detail: string;
  /** When the newest notification arrived, already formatted. */
  time: string;
  /** How many notifications the row stands for. */
  count: number;
  /** The notifications a stack unfolds into; may be fewer than `count`. */
  items: readonly InboxStackItem[];
  formatTime: (at: Date) => string;
  unfolded: boolean;
  unseen: boolean;
  highlighted: boolean;
  /** Buttons that act on the notification, below its text. */
  actions?: JSX.Element;
  onClick: (event: MouseEvent) => void;
  onHover: () => void;
  onDone: () => void;
  onToggleStack: () => void;
};

/**
 * One notification inbox row, as a card: what it is about, then who did what.
 * Several notifications show as a stack with paper edges, which unfolds in
 * place. With a pointer, the time and Mark done appear on hover; touch shows
 * the time and marks done by swiping the row.
 */
export function NotificationRow(props: NotificationRowProps) {
  const isStack = () => props.count > 1;
  return (
    <div
      id={props.id}
      role="row"
      aria-selected={props.highlighted}
      data-notification-row=""
      data-stack={isStack() ? '' : undefined}
      data-unfolded={props.unfolded ? '' : undefined}
      class={cn(
        'group/notification relative w-full min-w-0 flex-1 px-3',
        isStack() && !props.unfolded ? 'pb-5' : 'pb-2.5'
      )}
      onMouseMove={() => props.onHover()}
      onClick={(event) => props.onClick(event)}
    >
      <div
        role="gridcell"
        class={cn(
          'relative z-1 rounded-xl border',
          props.highlighted
            ? 'border-edge-frame bg-control-raised'
            : 'border-edge-button bg-control not-touch:hover:bg-surface-3'
        )}
      >
        {/* Leaves room for Mark done, which appears on hover. */}
        <div class="px-3 py-3 touch:min-h-[44px]">
          <div class="flex min-w-0 items-center gap-2 not-touch:group-hover/notification:pr-6">
            <span
              data-card-title=""
              class={cn(
                'min-w-0 flex-1 truncate text-sm',
                props.unseen ? 'font-medium text-ink' : 'text-ink-muted'
              )}
            >
              {/* Message and comment text carries mention and link markup. */}
              <StaticMarkdown
                markdown={props.title}
                singleLine
                theme={unifiedListMarkdownTheme}
              />
            </span>
            <Show when={isStack()}>
              <Button
                size="icon-xs"
                variant="ghost"
                // Touch sizes it up; it shouldn't make a stack's line taller.
                class="-my-2"
                data-stack-count=""
                aria-expanded={props.unfolded}
                aria-label={t('notificationsInbox.stackToggle', {
                  count: props.count,
                })}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onToggleStack();
                }}
              >
                <span class="text-xs font-normal text-ink-extra-muted tabular-nums">
                  {props.count}
                </span>
              </Button>
            </Show>
            <Show when={props.unseen}>
              <span
                aria-label={t('notificationsInbox.unread')}
                data-unread-dot=""
                class="size-1.5 shrink-0 rounded-full bg-accent not-touch:group-hover/notification:hidden"
              />
            </Show>
          </div>
          <div
            class={cn(
              'mt-[3px] flex min-w-0 gap-2 text-xs',
              props.unseen ? 'text-ink-extra-muted' : 'text-ink-extra-muted/80'
            )}
          >
            <span data-card-detail="" class="min-w-0 flex-1 truncate">
              <StaticMarkdown
                markdown={props.detail}
                singleLine
                theme={unifiedListMarkdownTheme}
              />
            </span>
            <span class="hidden shrink-0 touch:block not-touch:group-hover/notification:block">
              {props.time}
            </span>
          </div>
        </div>
        <Show when={props.actions}>
          <div
            class="flex flex-wrap gap-2 px-3 pb-3"
            onClick={(event) => event.stopPropagation()}
          >
            {props.actions}
          </div>
        </Show>
        <Show when={isStack() && props.unfolded}>
          <div
            data-stack-items=""
            class="mx-3 border-t border-edge-button pt-1 pb-2"
          >
            <For each={props.items}>
              {(item) => (
                <div class="py-2">
                  <div class="flex gap-2 text-xs text-ink-extra-muted/80">
                    <span class="min-w-0 flex-1 truncate">{item.by}</span>
                    <span class="shrink-0">{props.formatTime(item.at)}</span>
                  </div>
                  <div class="mt-[3px] text-sm text-ink-muted">
                    <StaticMarkdown
                      markdown={item.text}
                      theme={twoLineClampMarkdownTheme}
                    />
                  </div>
                </div>
              )}
            </For>
            <Show when={props.count > props.items.length}>
              <div class="py-1 text-xs text-ink-extra-muted/80">
                {t('notificationsInbox.stackMore', {
                  count: props.count - props.items.length,
                })}
              </div>
            </Show>
          </div>
        </Show>
        {/* Touch marks done by swiping the row instead. */}
        <div class="absolute top-2 right-2 hidden not-touch:group-hover/notification:block">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t('notificationsInbox.markDone')}
            tooltip={t('notificationsInbox.markDone')}
            onClick={(event) => {
              event.stopPropagation();
              props.onDone();
            }}
          >
            <CheckIcon class="size-4" />
          </Button>
        </div>
      </div>
      <Show when={isStack() && !props.unfolded}>
        <div
          aria-hidden="true"
          class="absolute inset-x-[19px] h-[5px] rounded-b-[9px] border border-t-0 border-edge-button bg-control/60"
        />
        <div
          aria-hidden="true"
          class="absolute inset-x-[26px] mt-[5px] h-[5px] rounded-b-[9px] border border-t-0 border-edge-button bg-control/30"
        />
      </Show>
    </div>
  );
}
