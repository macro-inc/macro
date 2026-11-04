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
  /** Opens the drawer, under its hairline. */
  first: boolean;
  /** Closes the card its stack unfolded from. */
  last: boolean;
  /** Notifications past the last one shown; said under the last item. */
  more: number;
  highlighted: boolean;
  onClick: (event: MouseEvent) => void;
  onHover: () => void;
};

/**
 * One notification of an unfolded stack, in a drawer below its card: a smaller
 * avatar under the card's, and text lined up with the card's, so it reads as what
 * the card contains. Choosing it opens that notification.
 */
export function NotificationStackItem(props: NotificationStackItemProps) {
  return (
    <div
      id={props.id}
      role="row"
      aria-selected={props.highlighted}
      data-stack-item=""
      class={cn(
        'relative w-full min-w-0 flex-1 px-3',
        props.last && 'pb-2.5 mobile:pb-3'
      )}
      onMouseMove={() => props.onHover()}
      onClick={(event) => props.onClick(event)}
    >
      <div
        role="gridcell"
        class={cn(
          'overflow-hidden border-x border-edge-frame bg-control',
          props.first && 'border-t',
          props.last && 'rounded-b-xl border-b'
        )}
      >
        <div
          class={cn(
            'flex gap-3 px-3 touch:min-h-[44px]',
            props.first ? 'pt-3' : 'pt-[9px]',
            props.last ? 'pb-3' : 'pb-[9px]',
            props.highlighted
              ? 'bg-control-raised mobile:bg-transparent'
              : 'not-touch:hover:bg-surface-3'
          )}
        >
          <span class="flex w-6 shrink-0 justify-center mobile:w-10">
            {props.icon}
          </span>
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
