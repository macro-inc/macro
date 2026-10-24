import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { unifiedListMarkdownTheme } from '@core/component/LexicalMarkdown/theme';
import CheckIcon from '@phosphor/check.svg';
import { Button, cn } from '@ui';
import { type JSX, Show } from 'solid-js';
import type { InboxRow } from '../core/inbox-row';
import { InboxRowIcon } from './inbox-row-icon';

export type NotificationRowProps = {
  /** The row's element id, for `aria-activedescendant`. */
  id: string;
  type: InboxRow<unknown>['type'];
  /** Muted "actor verb place" line, e.g. "Jacob assigned you a task". */
  action: string;
  /** What the notification is about: a subject, message, task or title. */
  subject: string;
  /** When the newest notification arrived, already formatted. */
  time: string;
  /** How many notifications the row stands for. */
  count: number;
  unseen: boolean;
  highlighted: boolean;
  /** Buttons that act on the notification, below the subject. */
  actions?: JSX.Element;
  onClick: (event: MouseEvent) => void;
  onHover: () => void;
  onDone: () => void;
};

/**
 * One notification inbox row: a type glyph, a muted line saying who did
 * what, the subject, and optional actions. With a pointer the time shows
 * until the row is hovered, when Mark done takes its place; touch marks done
 * by swiping the row.
 */
export function NotificationRow(props: NotificationRowProps) {
  return (
    <div
      id={props.id}
      role="row"
      aria-selected={props.highlighted}
      data-notification-row=""
      class={cn(
        'group/notification relative mx-(--sidebar-gutter) my-(--sidebar-row-gap) flex min-w-0 flex-1 gap-2.5 rounded-lg px-2 py-2 touch:min-h-[44px]',
        props.highlighted ? 'bg-active' : 'not-touch:hover:bg-hover'
      )}
      onMouseMove={() => props.onHover()}
      onClick={(event) => props.onClick(event)}
    >
      <div role="gridcell" class="flex min-w-0 flex-1 gap-2.5">
        <span
          class={cn(
            'mt-0.5 flex size-5 shrink-0 items-center justify-center',
            props.unseen ? 'text-ink' : 'text-ink-muted'
          )}
        >
          <InboxRowIcon type={props.type} class="size-4" />
        </span>
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <div class="flex min-w-0 items-center gap-2">
            <span class="min-w-0 flex-1 truncate text-sm text-ink-muted">
              {props.action}
            </span>
            <span class="shrink-0 text-xs text-ink-extra-muted not-touch:group-hover/notification:hidden">
              {props.time}
            </span>
            <Show when={props.unseen}>
              <span
                aria-label="Unread"
                class="size-1.5 shrink-0 rounded-full bg-accent"
              />
            </Show>
          </div>
          <div class="flex min-w-0 items-center gap-2">
            <span
              class={cn(
                'min-w-0 flex-1 truncate text-base',
                props.unseen ? 'font-medium text-ink' : 'text-ink'
              )}
            >
              {/* Message and comment text carries mention and link markup. */}
              <StaticMarkdown
                markdown={props.subject}
                singleLine
                theme={unifiedListMarkdownTheme}
              />
            </span>
            <Show when={props.count > 1}>
              <span class="shrink-0 text-xs text-ink-muted">{props.count}</span>
            </Show>
          </div>
          <Show when={props.actions}>
            <div
              class="mt-1.5 flex flex-wrap gap-2"
              onClick={(event) => event.stopPropagation()}
            >
              {props.actions}
            </div>
          </Show>
        </div>
      </div>
      {/* Touch marks done by swiping the row instead. */}
      <div class="absolute top-1.5 right-2 hidden not-touch:group-hover/notification:block">
        <Button
          size="icon-sm"
          label="Mark done"
          onClick={(event) => {
            event.stopPropagation();
            props.onDone();
          }}
        >
          <CheckIcon />
        </Button>
      </div>
    </div>
  );
}
