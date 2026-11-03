import { ViewSidebar } from '@app/components/view-shell';
import { formatRelativeDate } from '@core/util/time';
import CheckIcon from '@icon/system/regular/check.svg';
import { Button, Tooltip } from '@ui';
import { FeedItemIcon } from '../../for-you/components/feed-item-icon';
import type { FeedItem } from '../../for-you/core/feed';
import { FocusImportance } from './focus-importance';

export function FocusActionRow(props: {
  action: FeedItem;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  return (
    <li
      data-focus-row={props.action.id}
      class="group flex min-w-0 items-center gap-1 rounded-lg pr-1 not-touch:hover:bg-hover"
      classList={{ 'bg-active': props.selected }}
      onFocusIn={props.onSelect}
    >
      <ViewSidebar.Item
        active={props.selected}
        aria-current={false}
        data-focus-open
        class="h-16 min-w-0 flex-1"
        onClick={props.onOpen}
        aria-label={`Open suggestion: ${props.action.title}`}
      >
        <Tooltip
          as="span"
          label={`${props.action.title} — ${props.action.summary}`}
          class="min-w-0 flex-1"
        >
          <span class="flex min-w-0 flex-1 flex-col gap-1">
            <span class="flex min-w-0 items-center gap-2 font-medium text-ink">
              <FeedItemIcon item={props.action} class="size-4 shrink-0" />
              <span class="truncate">{props.action.title}</span>
            </span>
            <span class="truncate pl-6 text-xs text-ink-extra-muted">
              {props.action.summary}
            </span>
          </span>
        </Tooltip>
        <FocusImportance importance={props.action.importance} />
        <span class="w-20 shrink-0 text-right text-xs text-ink-extra-muted">
          {props.action.time && Number.isFinite(Date.parse(props.action.time))
            ? formatRelativeDate(props.action.time)
            : ''}
        </span>
      </ViewSidebar.Item>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Dismiss: ${props.action.title}`}
        tooltip="Set aside · E"
        onClick={props.onDismiss}
      >
        <CheckIcon class="size-4" />
      </Button>
    </li>
  );
}
