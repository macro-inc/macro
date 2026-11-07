import { t } from '@app/lib/i18n';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { twoLineClampMarkdownTheme } from '@core/component/LexicalMarkdown/theme';
import { isMobile } from '@core/mobile/isMobile';
import CheckIcon from '@icon/system/regular/check.svg';
import { Button, cn } from '@ui';
import { type JSX, Show } from 'solid-js';
import { RowSeparator, StackFoldButton } from './notification-row';

export type NotificationStackItemProps = {
  /** The item's element id, for `aria-activedescendant`. */
  id: string;
  /** Who it is from. */
  icon: JSX.Element;
  /** Who did what. */
  by: string;
  /** What was said, as Markdown. */
  text: string;
  /** When it arrived, already formatted. */
  time: string;
  /** The bottom of the stack, which ends it. */
  last: boolean;
  /** How many notifications its stack stands for. */
  count: number;
  /** The stack ends its date section, so nothing separates it from the next. */
  endsSection?: boolean;
  /** Notifications past the last one shown; said under the last item. */
  more: number;
  /** Whether its stack is unread, which it looks like. */
  unseen: boolean;
  highlighted: boolean;
  onClick: (event: MouseEvent) => void;
  onHover: () => void;
  /** Complete this notification and leave the rest of the stack. */
  onDone: () => void;
  /** Fold its stack, from Hide below the last notification. */
  onToggleStack: () => void;
};

/**
 * One notification of an open stack, listed under its row and indented to the
 * row's text, looking as read or unread as the row it came from. Choosing it
 * opens that notification. A hairline from its own text separates it from the
 * next; the last one's starts at the row's text, ending the stack, and away from
 * a phone the stack's caret sits above it as Hide. With a pointer, Mark done
 * takes the time's place on hover, as on the row; touch marks it done by
 * swiping it.
 */
export function NotificationStackItem(props: NotificationStackItemProps) {
  return (
    <div
      id={props.id}
      role="row"
      aria-selected={props.highlighted}
      data-stack-item=""
      class={cn(
        'group/stack-item relative w-full min-w-0 flex-1',
        // A tap leaves the item focused, which mustn't look chosen on a phone.
        props.highlighted
          ? 'bg-active mobile:bg-transparent'
          : 'not-touch:hover:bg-hover'
      )}
      onMouseMove={() => props.onHover()}
      onClick={(event) => props.onClick(event)}
    >
      <div
        role="gridcell"
        class="flex gap-2 py-2 pr-4 pl-[52px] touch:min-h-[44px] mobile:gap-2.5 mobile:py-2.5 mobile:pl-[68px]"
      >
        <span class={cn('shrink-0', !props.unseen && 'mobile:opacity-60')}>
          {props.icon}
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex gap-2 text-xs mobile:text-[13px] mobile:leading-[18px]">
            <span
              class={cn(
                'min-w-0 flex-1 truncate',
                props.unseen
                  ? 'text-ink-muted'
                  : 'text-ink-muted mobile:text-ink-extra-muted'
              )}
            >
              {props.by}
            </span>
            <span class="relative shrink-0">
              <span class="block text-ink-extra-muted/80 not-touch:group-hover/stack-item:invisible">
                {props.time}
              </span>
              {/* Touch marks done by swiping the item instead. */}
              <span class="absolute top-1/2 -right-1.5 hidden -translate-y-1/2 not-touch:group-hover/stack-item:block">
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
          <div
            data-stack-item-text=""
            class={cn(
              'mt-0.5 text-[13px] leading-[18px] mobile:text-sm mobile:leading-5',
              props.unseen
                ? 'text-ink'
                : 'text-ink-muted mobile:text-ink-extra-muted'
            )}
          >
            {/* An agent's message can run to many paragraphs and lists. */}
            <StaticMarkdown
              markdown={props.text}
              singleLine
              theme={twoLineClampMarkdownTheme}
            />
          </div>
          <Show when={props.more > 0}>
            <div class="mt-1 text-xs text-ink-extra-muted/80">
              {t('notificationsInbox.stackMore', { count: props.more })}
            </div>
          </Show>
        </div>
      </div>
      <Show when={props.last && !isMobile()}>
        {/* Not the notification: only the button answers here. */}
        <div
          class="-mt-1 pr-4 pb-3 pl-[52px]"
          onClick={(event) => event.stopPropagation()}
        >
          <StackFoldButton
            count={props.count}
            unfolded
            onToggle={(event) => {
              event.stopPropagation();
              props.onToggleStack();
            }}
          />
        </div>
      </Show>
      <Show when={!props.last || !props.endsSection}>
        <RowSeparator nested={!props.last} />
      </Show>
    </div>
  );
}
