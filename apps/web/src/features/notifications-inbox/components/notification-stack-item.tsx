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
  /** Closes the card its stack unfolded from. */
  last: boolean;
  /** Notifications past the last one shown; said under the last item. */
  more: number;
  /** Whether the stack it belongs to is unread. */
  unseen: boolean;
  highlighted: boolean;
  onClick: (event: MouseEvent) => void;
  onHover: () => void;
};

/**
 * One notification of an unfolded stack: a section of the card above it, which
 * opens that notification.
 */
export function NotificationStackItem(props: NotificationStackItemProps) {
  return (
    <div
      id={props.id}
      role="row"
      aria-selected={props.highlighted}
      data-stack-item=""
      class={cn(
        'relative w-full min-w-0 flex-1 px-3 mobile:px-0',
        props.last && 'pb-2.5 mobile:pb-3'
      )}
      onMouseMove={() => props.onHover()}
      onClick={(event) => props.onClick(event)}
    >
      <div
        role="gridcell"
        class={cn(
          'overflow-hidden border-x border-t border-edge-button bg-control mobile:rounded-none mobile:border-x-0',
          props.last && 'rounded-b-xl border-b',
          !props.unseen && 'mobile:bg-transparent'
        )}
      >
        <div
          class={cn(
            'flex gap-2.5 px-3 py-2.5 touch:min-h-[44px]',
            props.highlighted
              ? 'bg-control-raised mobile:bg-transparent'
              : 'not-touch:hover:bg-surface-3'
          )}
        >
          <span class={cn('shrink-0', !props.unseen && 'mobile:opacity-60')}>
            {props.icon}
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex gap-2 text-xs text-ink-extra-muted/80 mobile:text-[13px] mobile:leading-[18px]">
              <span class="min-w-0 flex-1 truncate">{props.by}</span>
              <span class="shrink-0">{props.time}</span>
            </div>
            <div
              class={cn(
                'mt-[3px] text-sm text-ink-muted mobile:text-base',
                !props.unseen && 'mobile:text-ink-extra-muted'
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
