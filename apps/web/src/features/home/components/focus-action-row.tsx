import { ViewSidebar } from '@app/components/view-shell';
import ChatIcon from '@icon/system/regular/chat-circle.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import MailIcon from '@icon/system/regular/envelope.svg';
import LinkIcon from '@icon/system/regular/link.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import { Button, Tooltip } from '@ui';
import type { Component } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { FocusAction } from '../core/focus-actions';
import { FocusImportance } from './focus-importance';

const FOCUS_ICONS: Record<
  FocusAction['type'],
  Component<{ class?: string }>
> = {
  EMAIL_DRAFT: MailIcon,
  MSG_DRAFT: ChatIcon,
  CREATE_ROUTINE: SparkleIcon,
  LINK: LinkIcon,
};

export function FocusActionIcon(props: { type: FocusAction['type'] }) {
  return (
    <Dynamic component={FOCUS_ICONS[props.type]} class="size-4 shrink-0" />
  );
}

export function FocusActionRow(props: {
  action: FocusAction;
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
        aria-label={`${props.action.actionLabel}: ${props.action.title}`}
      >
        <Tooltip
          as="span"
          label={`${props.action.title} — ${props.action.source}: ${props.action.reason}`}
          class="min-w-0 flex-1"
        >
          <span class="flex min-w-0 flex-1 flex-col gap-1">
            <span class="flex min-w-0 items-center gap-2 font-medium text-ink">
              <FocusActionIcon type={props.action.type} />
              <span class="truncate">{props.action.title}</span>
            </span>
            <span class="truncate pl-6 text-xs text-ink-extra-muted">
              {props.action.source} · {props.action.reason}
            </span>
          </span>
        </Tooltip>
        <FocusImportance importance={props.action.importance} />
        <span class="w-20 shrink-0 text-right text-xs text-ink-extra-muted">
          {props.action.time}
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
