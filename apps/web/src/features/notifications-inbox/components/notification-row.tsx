import { t } from '@app/lib/i18n';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import {
  twoLineClampMarkdownTheme,
  unifiedListMarkdownTheme,
} from '@core/component/LexicalMarkdown/theme';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import { Button, cn } from '@ui';
import { type JSX, Show } from 'solid-js';

export type NotificationRowProps = {
  /** The row's element id, for `aria-activedescendant`. */
  id: string;
  /** Who it is from. */
  icon: JSX.Element;
  /** Who did it. */
  who: string;
  /** What it is about: a subject, channel, document, session or task. */
  what?: string;
  /** What was said, as Markdown; at most two lines show. */
  body?: string;
  /** When the newest notification arrived, already formatted. */
  time: string;
  /** How many notifications the row stands for. */
  count: number;
  unfolded: boolean;
  unseen: boolean;
  highlighted: boolean;
  /** Another stack is open, so this card steps back. */
  receded?: boolean;
  /** Buttons that act on the notification, below its text. */
  actions?: JSX.Element;
  onClick: (event: MouseEvent) => void;
  onHover: () => void;
  onDone: () => void;
  onToggleStack: () => void;
};

/**
 * One notification inbox row, as a card as tall as it has something to say: who
 * did it, what it is about, and what was said. Choosing it opens it. Several
 * notifications show as a stack with paper edges, and its own button spreads them
 * into small cards below it, leaving this card as it was.
 * With a pointer, Mark done takes the time's
 * place on hover and nothing else moves; the time ends the line, so the button
 * sits in the same spot on every card. Touch marks done by swiping the row. A
 * phone shows larger text, and a read card gives up its fill and fades, so unread
 * ones stand out at a glance.
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
        'group/notification relative w-full min-w-0 flex-1 px-3 transition-opacity',
        props.receded && 'opacity-40 not-touch:hover:opacity-100',
        isStack() && !props.unfolded && 'pb-5 mobile:pb-5.5',
        !isStack() && 'pb-2.5 mobile:pb-3'
      )}
      onMouseMove={() => props.onHover()}
      onClick={(event) => props.onClick(event)}
    >
      <div
        role="gridcell"
        class={cn(
          // The avatar's badge cuts itself out in this color.
          'relative z-1 border bg-(--inbox-card-surface)',
          'rounded-xl',
          props.highlighted
            ? 'border-edge-frame [--inbox-card-surface:var(--color-control-raised)]'
            : 'border-edge-button [--inbox-card-surface:var(--color-control)] not-touch:hover:[--inbox-card-surface:var(--color-surface-3)]',
          // A tap leaves the card focused, which mustn't look like unread.
          'mobile:border-edge-button',
          props.unseen
            ? 'mobile:[--inbox-card-surface:var(--color-control)]'
            : 'mobile:[--inbox-card-surface:var(--color-panel)]'
        )}
      >
        <div class="flex gap-3 px-3 py-3 touch:min-h-[44px]">
          <span
            class={cn('shrink-0', !props.unseen && 'mobile:opacity-60')}
            data-card-avatar=""
          >
            {props.icon}
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex min-w-0 items-center gap-2">
              <span
                data-card-who=""
                class={cn(
                  'min-w-0 flex-1 truncate text-sm mobile:text-base mobile:leading-[22px]',
                  props.unseen
                    ? 'font-medium text-ink'
                    : 'text-ink-muted mobile:text-ink-extra-muted'
                )}
              >
                {/* Message and comment text carries mention and link markup. */}
                <StaticMarkdown
                  markdown={props.who}
                  singleLine
                  theme={unifiedListMarkdownTheme}
                />
              </span>
              <Show when={isStack()}>
                <Button
                  size="icon-xs"
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
                  <CaretDownIcon
                    class={cn(
                      'size-3.5 text-ink-extra-muted',
                      props.unfolded && 'rotate-180'
                    )}
                  />
                </Button>
              </Show>
              <Show when={props.unseen}>
                <span
                  aria-label={t('notificationsInbox.unread')}
                  data-unread-dot=""
                  class="size-1.5 shrink-0 rounded-full bg-accent mobile:size-2"
                />
              </Show>
              {/* The time ends the line, after the caret and unread dot, so Mark done,
                  which takes its place on hover, sits in the same spot on every
                  card, stacked or not, read or not, and nothing moves. */}
              <span class="relative shrink-0">
                <span
                  data-card-time=""
                  class={cn(
                    'block text-xs not-touch:group-hover/notification:invisible mobile:text-[13px] mobile:leading-[18px]',
                    props.unseen
                      ? 'text-ink-extra-muted mobile:text-ink-muted'
                      : 'text-ink-extra-muted/80'
                  )}
                >
                  {props.time}
                </span>
                {/* Touch marks done by swiping the row instead. */}
                <span class="absolute top-1/2 -right-1.5 hidden -translate-y-1/2 not-touch:group-hover/notification:block">
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
                </span>
              </span>
            </div>
            <Show when={props.what}>
              {(what) => (
                <div
                  data-card-what=""
                  class={cn(
                    'mt-px truncate text-[13px] leading-[18px] mobile:text-sm mobile:leading-5',
                    props.unseen
                      ? 'text-ink'
                      : 'text-ink-muted mobile:text-ink-extra-muted'
                  )}
                >
                  <StaticMarkdown
                    markdown={what()}
                    singleLine
                    theme={unifiedListMarkdownTheme}
                  />
                </div>
              )}
            </Show>
            <Show when={props.body}>
              {(body) => (
                <div
                  data-card-body=""
                  class={cn(
                    'mt-0.5 text-xs mobile:text-[13px] mobile:leading-[18px]',
                    props.unseen
                      ? 'text-ink-extra-muted'
                      : 'text-ink-extra-muted/80'
                  )}
                >
                  {/* An agent's message can run to many paragraphs and lists. */}
                  <StaticMarkdown
                    markdown={body()}
                    singleLine
                    theme={twoLineClampMarkdownTheme}
                  />
                </div>
              )}
            </Show>
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
      </div>
      <Show when={isStack() && !props.unfolded}>
        <div
          aria-hidden="true"
          data-stack-edge=""
          class={cn(
            'absolute inset-x-[19px] h-[5px] rounded-b-[9px] border border-t-0 border-edge-button bg-control/60',
            !props.unseen && 'mobile:bg-transparent'
          )}
        />
        <div
          aria-hidden="true"
          data-stack-edge=""
          class={cn(
            'absolute inset-x-[26px] mt-[5px] h-[5px] rounded-b-[9px] border border-t-0 border-edge-button bg-control/30',
            !props.unseen && 'mobile:bg-transparent'
          )}
        />
      </Show>
    </div>
  );
}
