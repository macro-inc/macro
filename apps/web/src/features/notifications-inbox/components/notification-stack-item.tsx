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
  highlighted: boolean;
  onClick: (event: MouseEvent) => void;
  onHover: () => void;
};

/**
 * One notification of an open stack: a sheet of the stack spread into its own
 * small card, indented under the card it came from. Choosing it opens that
 * notification.
 */
export function NotificationStackItem(props: NotificationStackItemProps) {
  return (
    <div
      id={props.id}
      role="row"
      aria-selected={props.highlighted}
      data-stack-item=""
      class={cn(
        'relative w-full min-w-0 flex-1 pt-1.5 pr-3 pl-6 mobile:pl-7',
        props.last && 'pb-2.5 mobile:pb-3'
      )}
      onMouseMove={() => props.onHover()}
      onClick={(event) => props.onClick(event)}
    >
      <div
        role="gridcell"
        class={cn(
          'overflow-hidden rounded-xl border bg-control-raised',
          props.highlighted
            ? 'border-ink-extra-muted/50 mobile:border-edge-frame'
            : 'border-edge-frame'
        )}
      >
        <div class="flex gap-2.5 px-3 py-2.5 touch:min-h-[44px] not-touch:hover:overlay-hover">
          <span class="shrink-0">{props.icon}</span>
          <div class="min-w-0 flex-1">
            <div class="flex gap-2 text-xs mobile:text-[13px] mobile:leading-[18px]">
              <span class="min-w-0 flex-1 truncate text-ink-muted">
                {props.by}
              </span>
              <span class="shrink-0 text-ink-extra-muted/80">{props.time}</span>
            </div>
            <div
              data-stack-item-text=""
              class="mt-0.5 text-[13px] leading-[18px] text-ink mobile:text-sm mobile:leading-5"
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
          <div class="border-t border-edge-frame px-3 py-2 text-xs text-ink-extra-muted/80">
            {t('notificationsInbox.stackMore', { count: props.more })}
          </div>
        </Show>
      </div>
    </div>
  );
}
