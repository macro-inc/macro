import { t } from '@app/lib/i18n';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { twoLineClampMarkdownTheme } from '@core/component/LexicalMarkdown/theme';
import { cn } from '@ui';
import { type JSX, Show } from 'solid-js';

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
  /** The bottom of the stack, which spaces it from the next card. */
  last: boolean;
  /** Notifications past the last one shown; said under the last item. */
  more: number;
  /** Whether its stack is unread, which it looks like. */
  unseen: boolean;
  highlighted: boolean;
  onClick: (event: MouseEvent) => void;
  onHover: () => void;
};

/**
 * One notification of an open stack: a sheet of the stack spread into its own
 * small card, inset evenly where its paper edge sat, and looking as read or unread
 * as the card it came from. Choosing it opens that notification.
 */
export function NotificationStackItem(props: NotificationStackItemProps) {
  return (
    <div
      id={props.id}
      role="row"
      aria-selected={props.highlighted}
      data-stack-item=""
      class={cn(
        'relative w-full min-w-0 flex-1 px-[19px] pt-1.5',
        props.last && 'pb-2.5 mobile:pb-3'
      )}
      onMouseMove={() => props.onHover()}
      onClick={(event) => props.onClick(event)}
    >
      <div
        role="gridcell"
        class={cn(
          'overflow-hidden rounded-xl border',
          props.highlighted
            ? 'border-edge-frame bg-control-raised'
            : 'border-edge-button bg-control not-touch:hover:bg-surface-3',
          'mobile:border-edge-button',
          props.unseen ? 'mobile:bg-control' : 'mobile:bg-transparent'
        )}
      >
        <div class="flex gap-2.5 px-3 py-2.5 touch:min-h-[44px]">
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
              <span class="shrink-0 text-ink-extra-muted/80">{props.time}</span>
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
          </div>
        </div>
        <Show when={props.more > 0}>
          <div class="border-t border-edge-button px-3 py-2 text-xs text-ink-extra-muted/80">
            {t('notificationsInbox.stackMore', { count: props.more })}
          </div>
        </Show>
      </div>
    </div>
  );
}
