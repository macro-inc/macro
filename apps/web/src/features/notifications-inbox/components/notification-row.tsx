import { t } from '@app/lib/i18n';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import {
  twoLineClampMarkdownTheme,
  unifiedListMarkdownTheme,
} from '@core/component/LexicalMarkdown/theme';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import { isMobile } from '@core/mobile/isMobile';
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
  /** Another stack is open, so this row steps back. */
  receded?: boolean;
  /** The last row of its date section, which has no separator below it. */
  endsSection?: boolean;
  /** Buttons that act on the notification, below its text. */
  actions?: JSX.Element;
  onClick: (event: MouseEvent) => void;
  onHover: () => void;
  onDone: () => void;
  onToggleStack: () => void;
};

/**
 * One notification inbox row, as tall as it has something to say: who did it,
 * what it is about, and what was said. Choosing it opens it. Rows sit flat on
 * the panel, each with a hairline below it that starts where its text does, as
 * in Messages; a section's last row has none. Several notifications show as a
 * stack: a phone unfolds it from a caret on the first line, and elsewhere a
 * caret with how many more there are sits at the bottom of the row. Unfolded,
 * its notifications list below it, indented to its text.
 * With a pointer, Mark done shows on hover in its own slot just before the
 * unread dot, held empty otherwise, so it sits in the same spot on every row
 * and nothing moves. Touch marks done by swiping the row. A phone shows larger
 * text, and a read row fades its avatar, so unread ones stand out at a glance.
 */
export function NotificationRow(props: NotificationRowProps) {
  const isStack = () => props.count > 1;
  const isOpen = () => isStack() && props.unfolded;
  // A phone keeps the caret on the first line; a wider list shows it, with
  // how many more there are, at the bottom of the folded stack.
  const caretOnTop = () => isMobile();
  const toggle = (event: MouseEvent) => {
    event.stopPropagation();
    props.onToggleStack();
  };
  return (
    <div
      id={props.id}
      role="row"
      aria-selected={props.highlighted}
      data-notification-row=""
      data-stack={isStack() ? '' : undefined}
      data-unfolded={isOpen() ? '' : undefined}
      class={cn(
        'group/notification relative w-full min-w-0 flex-1 transition-opacity',
        // The list's hover and active tints laid over the panel, opaque so the
        // avatar's badge can cut itself out in the same color.
        'bg-(--inbox-row-surface) [--inbox-row-surface:var(--color-panel)]',
        props.highlighted
          ? '[--inbox-row-surface:color-mix(in_srgb,var(--color-panel),var(--color-content-0)_6%)]'
          : 'not-touch:hover:[--inbox-row-surface:color-mix(in_srgb,var(--color-panel),var(--color-content-0)_3%)]',
        // A tap leaves the row focused, which mustn't look chosen on a phone.
        'mobile:[--inbox-row-surface:var(--color-panel)]',
        props.receded && 'opacity-40 not-touch:hover:opacity-100'
      )}
      onMouseMove={() => props.onHover()}
      onClick={(event) => props.onClick(event)}
    >
      <div role="gridcell" class="flex gap-3 px-4 py-3 touch:min-h-[44px]">
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
            <span
              data-card-time=""
              class={cn(
                'shrink-0 text-xs mobile:text-[13px] mobile:leading-[18px]',
                props.unseen
                  ? 'text-ink-extra-muted mobile:text-ink-muted'
                  : 'text-ink-extra-muted/80'
              )}
            >
              {props.time}
            </span>
            <Show when={isStack() && caretOnTop()}>
              <Button
                size="icon-xs"
                variant="ghost"
                // Its frame is taller than the line; it shouldn't grow the row.
                class="-my-1 shrink-0 touch:-my-3 touch:-mr-1"
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
                onClick={toggle}
              >
                <CaretDownIcon
                  class={cn(
                    'size-3.5 text-ink-extra-muted',
                    props.unfolded && 'rotate-180'
                  )}
                />
              </Button>
            </Show>
            {/* Mark done's slot, held on every row with a pointer so the button
                shows in the same place on all of them; touch swipes instead. */}
            <span class="relative hidden size-4 shrink-0 not-touch:block">
              <span class="absolute top-1/2 left-1/2 hidden -translate-x-1/2 -translate-y-1/2 not-touch:group-hover/notification:block">
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
            {/* A read row keeps the dot's room, so Mark done doesn't move. */}
            <Show
              when={props.unseen}
              fallback={
                <span
                  aria-hidden="true"
                  class="hidden size-1.5 shrink-0 not-touch:block"
                />
              }
            >
              <span
                aria-label={t('notificationsInbox.unread')}
                data-unread-dot=""
                class="size-1.5 shrink-0 rounded-full bg-accent mobile:size-2"
              />
            </Show>
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
          {/* Unfolded, the caret moves to the bottom of the stack's last
              notification as Hide. */}
          <Show when={isStack() && !caretOnTop() && !props.unfolded}>
            <StackFoldButton
              count={props.count}
              unfolded={false}
              onToggle={toggle}
            />
          </Show>
        </div>
      </div>
      <Show when={!isOpen() && !props.endsSection}>
        <RowSeparator />
      </Show>
    </div>
  );
}

/**
 * The hairline below a row, from where its text starts to the right edge.
 * `nested` starts it at an unfolded notification's text instead.
 */
export function RowSeparator(props: { nested?: boolean }) {
  return (
    <span
      aria-hidden="true"
      data-row-separator=""
      class={cn(
        'pointer-events-none absolute right-0 bottom-0 h-px bg-edge',
        props.nested
          ? 'left-[76px] mobile:left-[102px]'
          : 'left-[52px] mobile:left-[68px]'
      )}
    />
  );
}

/**
 * A stack's caret at its bottom, with what it does: how many more there are
 * while it is folded, or Hide once it is open.
 */
export function StackFoldButton(props: {
  /** How many notifications the stack stands for. */
  count: number;
  unfolded: boolean;
  onToggle: (event: MouseEvent) => void;
}) {
  return (
    <Button
      variant="ghost"
      size="xs"
      class="mt-1 -mb-1 -ml-1.5 gap-1 px-1.5 font-medium text-ink-extra-muted"
      data-stack-toggle=""
      aria-expanded={props.unfolded}
      aria-label={t('notificationsInbox.stackToggle', { count: props.count })}
      onClick={(event) => props.onToggle(event)}
    >
      <CaretDownIcon
        class={cn('size-3.5 shrink-0', props.unfolded && 'rotate-180')}
      />
      {props.unfolded
        ? t('notificationsInbox.stackHideShort')
        : t('notificationsInbox.stackShowMore', { count: props.count - 1 })}
    </Button>
  );
}
