import { t } from '@app/lib/i18n';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { unifiedListMarkdownTheme } from '@core/component/LexicalMarkdown/theme';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import { Button, cn } from '@ui';
import { type JSX, Show } from 'solid-js';

export type NotificationRowProps = {
  /** The row's element id, for `aria-activedescendant`. */
  id: string;
  /** Who it is from. */
  icon: JSX.Element;
  /** What the card is about: a subject, message, channel or document. */
  title: string;
  /** Who did what. */
  detail: string;
  /** When the newest notification arrived, already formatted. */
  time: string;
  /** How many notifications the row stands for. */
  count: number;
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
 * One notification inbox row, as a card: who it is from, what it is about, then
 * who did what. Choosing it opens it. Several notifications show as a stack with
 * paper edges, and its own button unfolds them below the card, which they
 * continue. With a pointer, the time and Mark done appear on hover; touch shows
 * the time and marks done by swiping the row. A phone runs the card edge to edge
 * with larger text, and a read card gives up its fill and fades, so unread ones
 * stand out at a glance.
 */
export function NotificationRow(props: NotificationRowProps) {
  const isStack = () => props.count > 1;
  const isOpen = () => isStack() && props.unfolded;
  return (
    <div
      id={props.id}
      role="row"
      aria-selected={props.highlighted}
      data-notification-row=""
      data-stack={isStack() ? '' : undefined}
      data-unfolded={isOpen() ? '' : undefined}
      class={cn(
        'group/notification relative w-full min-w-0 flex-1 px-3 mobile:px-0',
        isStack() && !props.unfolded && 'pb-5 mobile:pb-5.5',
        !isStack() && 'pb-2.5 mobile:pb-3'
      )}
      onMouseMove={() => props.onHover()}
      onClick={(event) => props.onClick(event)}
    >
      <div
        role="gridcell"
        class={cn(
          'relative z-1 border mobile:rounded-none mobile:border-x-0',
          isOpen() ? 'rounded-t-xl border-b-0' : 'rounded-xl',
          props.highlighted
            ? 'border-edge-frame bg-control-raised'
            : 'border-edge-button bg-control not-touch:hover:bg-surface-3',
          // A tap leaves the card focused, which mustn't look like unread.
          'mobile:border-edge-button',
          props.unseen ? 'mobile:bg-control' : 'mobile:bg-transparent'
        )}
      >
        <div class="flex gap-2.5 px-3 py-3 touch:min-h-[44px]">
          <span
            class={cn('shrink-0', !props.unseen && 'mobile:opacity-60')}
            data-card-avatar=""
          >
            {props.icon}
          </span>
          <div class="min-w-0 flex-1">
            {/* Leaves room for Mark done, which appears on hover. */}
            <div class="flex min-w-0 items-center gap-2 not-touch:group-hover/notification:pr-6">
              <span
                data-card-title=""
                class={cn(
                  'min-w-0 flex-1 truncate text-sm mobile:text-base',
                  props.unseen
                    ? 'font-medium text-ink'
                    : 'text-ink-muted mobile:text-ink-extra-muted'
                )}
              >
                {/* Message and comment text carries mention and link markup. */}
                <StaticMarkdown
                  markdown={props.title}
                  singleLine
                  theme={unifiedListMarkdownTheme}
                />
              </span>
              <Show when={props.unseen}>
                <span
                  aria-label={t('notificationsInbox.unread')}
                  data-unread-dot=""
                  class="size-1.5 shrink-0 rounded-full bg-accent not-touch:group-hover/notification:hidden mobile:size-2"
                />
              </Show>
            </div>
            <div
              class={cn(
                'mt-[3px] flex min-w-0 items-center gap-2 text-xs mobile:text-[13px] mobile:leading-[18px]',
                props.unseen
                  ? 'text-ink-extra-muted mobile:text-ink-muted'
                  : 'text-ink-extra-muted/80'
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
              <Show when={isStack()}>
                <Button
                  size="xs"
                  variant="ghost"
                  // Its frame is taller than the line; it shouldn't grow the card.
                  class="-my-1 -mr-1 shrink-0 touch:-my-3"
                  data-stack-toggle=""
                  aria-expanded={props.unfolded}
                  aria-label={t('notificationsInbox.stackToggle', {
                    count: props.count,
                  })}
                  tooltip={
                    props.unfolded
                      ? t('notificationsInbox.stackHide')
                      : t('notificationsInbox.stackShow')
                  }
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onToggleStack();
                  }}
                >
                  <span class="font-normal text-ink-extra-muted tabular-nums mobile:text-[13px]">
                    {props.count}
                  </span>
                  <CaretDownIcon
                    class={cn(
                      'size-3 text-ink-extra-muted',
                      props.unfolded && 'rotate-180'
                    )}
                  />
                </Button>
              </Show>
            </div>
            <Show when={props.actions}>
              <div
                class="mt-2.5 flex flex-wrap gap-2"
                onClick={(event) => event.stopPropagation()}
              >
                {props.actions}
              </div>
            </Show>
          </div>
        </div>
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
          data-stack-edge=""
          class={cn(
            'absolute inset-x-[19px] h-[5px] rounded-b-[9px] border border-t-0 border-edge-button bg-control/60 mobile:inset-x-[7px]',
            !props.unseen && 'mobile:bg-transparent'
          )}
        />
        <div
          aria-hidden="true"
          data-stack-edge=""
          class={cn(
            'absolute inset-x-[26px] mt-[5px] h-[5px] rounded-b-[9px] border border-t-0 border-edge-button bg-control/30 mobile:inset-x-[14px]',
            !props.unseen && 'mobile:bg-transparent'
          )}
        />
      </Show>
    </div>
  );
}
