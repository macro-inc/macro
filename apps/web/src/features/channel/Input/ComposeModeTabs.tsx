import { TabsInset } from '@core/component/TabsInset';
import CalendarBlankIcon from '@phosphor/calendar-blank.svg';
import ChatTextIcon from '@phosphor/chat-text.svg';
import CheckSquareIcon from '@phosphor/check-square.svg';
import type { JSX } from 'solid-js';
import { type ChannelComposeMode, coerceComposeMode } from './compose-mode';

function tabIcon(title: string, icon: JSX.Element) {
  return (
    <span title={title} aria-label={title} class="flex items-center">
      {icon}
    </span>
  );
}

/**
 * The compose-mode toggle shown at the input footer's bottom left — an
 * icon-only inset tab per face (chat, task, event), the same raised-pill
 * control the channel header's collapsed tabs use. The active face's tab
 * is elevated; picking another swaps the input's face.
 */
export function ComposeModeTabs(props: {
  mode: ChannelComposeMode;
  /** Whether the event tab is offered. The chat and task tabs always are. */
  showEvent: boolean;
  onModeChange: (mode: ChannelComposeMode) => void;
}) {
  const list = () => [
    {
      value: 'message',
      label: tabIcon('Chat', <ChatTextIcon class="size-4" />),
    },
    {
      value: 'task',
      label: tabIcon('Task', <CheckSquareIcon class="size-4" />),
    },
    ...(props.showEvent
      ? [
          {
            value: 'event',
            label: tabIcon('Event', <CalendarBlankIcon class="size-4" />),
          },
        ]
      : []),
  ];

  return (
    <TabsInset
      list={list()}
      value={props.mode}
      onChange={(value) => props.onModeChange(coerceComposeMode(value))}
    />
  );
}
