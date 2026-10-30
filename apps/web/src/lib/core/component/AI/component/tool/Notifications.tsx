import BellSlash from '@icon/system/regular/bell-slash.svg';
import BellZ from '@icon/system/regular/bell-z.svg';
import Check from '@icon/system/regular/check.svg';
import List from '@icon/system/regular/list.svg';
import type { ListNotifications as ListNotificationsTool } from '@service-cognition/generated/tools/types';
import { Show } from 'solid-js';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

type NotificationFilterType = NonNullable<
  ListNotificationsTool['includeTypes']
>[number];

const NOTIFICATION_TYPE_LABELS: Record<NotificationFilterType, string> = {
  email: 'emails',
  message: 'messages',
  channel: 'channels',
  document: 'documents',
  project: 'projects',
  chat: 'chats',
  call: 'calls',
  task: 'tasks',
  github: 'GitHub',
  reminder: 'reminders',
  calendar: 'calendar events',
  agent: 'agent sessions',
};

const formatList = (items: string[]) => {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
};

const formatNotificationFilters = (filters: ListNotificationsTool) => {
  const states = filters.states ?? ['unseen', 'seen'];
  let text = states.length
    ? `filtered by ${states.join(' or ')}`
    : 'all notification states';

  if (filters.includeTypes?.length) {
    text += ` in ${formatList(
      filters.includeTypes.map((type) => NOTIFICATION_TYPE_LABELS[type])
    )}`;
  }

  if (filters.entities?.length) {
    text += ` for ${filters.entities.length} ${
      filters.entities.length === 1 ? 'entity' : 'entities'
    }`;
  }

  return text;
};

const listNotificationsHandler = createToolRenderer({
  name: 'ListNotifications',
  render: (ctx) => {
    const count = () => ctx.response?.data.notifications.length ?? 0;
    const statusText = () => {
      if (!ctx.response) return undefined;
      if (count() === 0) return 'No notifications read';
      if (count() === 1) return 'Read 1 notification';
      return `Read ${count()} notifications`;
    };

    return (
      <BaseTool
        align="start"
        icon={List}
        renderContext={ctx.renderContext}
        type="call"
      >
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <div class="flex min-w-0 items-center justify-between gap-3 overflow-hidden">
            <span class="min-w-0 truncate">Read notifications</span>
            <Show when={statusText()}>
              {(text) => (
                <span class="shrink-0 whitespace-nowrap text-xs text-ink-extra-muted">
                  {text()}
                </span>
              )}
            </Show>
          </div>
          <div class="min-w-0 truncate text-xs text-ink-placeholder">
            {formatNotificationFilters(ctx.tool.data)}
          </div>
        </div>
      </BaseTool>
    );
  },
});

const markNotificationsSeenHandler = createToolRenderer({
  name: 'MarkNotificationsSeen',
  render: (ctx) => (
    <BaseTool icon={Check} renderContext={ctx.renderContext} type="call">
      Mark <span class="text-ink">{ctx.tool.data.notificationIds.length}</span>{' '}
      notification{ctx.tool.data.notificationIds.length === 1 ? '' : 's'} seen
    </BaseTool>
  ),
});

const markNotificationsDoneHandler = createToolRenderer({
  name: 'MarkNotificationsDone',
  render: (ctx) => (
    <BaseTool icon={Check} renderContext={ctx.renderContext} type="call">
      Mark <span class="text-ink">{ctx.tool.data.notificationIds.length}</span>{' '}
      notification{ctx.tool.data.notificationIds.length === 1 ? '' : 's'}{' '}
      {ctx.tool.data.done ? 'done' : 'not done'}
    </BaseTool>
  ),
});

const muteNotificationsHandler = createToolRenderer({
  name: 'MuteNotifications',
  render: (ctx) => {
    const label = () => {
      const done = !!ctx.response;
      switch (ctx.tool.data.action) {
        case 'mute':
          return done ? 'Muted notifications' : 'Mute notifications';
        case 'snooze':
          return done ? 'Snoozed notifications' : 'Snooze notifications';
        case 'unmute':
          return done ? 'Unmuted notifications' : 'Unmute notifications';
      }
    };
    const until = () => {
      const value = ctx.tool.data.snoozeUntil;
      return value ? new Date(value).toLocaleString() : undefined;
    };

    return (
      <BaseTool
        icon={ctx.tool.data.action === 'snooze' ? BellZ : BellSlash}
        renderContext={ctx.renderContext}
        type="call"
      >
        <div class="min-w-0 flex-1">
          {label()} for a {ctx.tool.data.entityType.replaceAll('_', ' ')}
          <Show when={until()}>{(time) => <> until {time()}</>}</Show>
        </div>
      </BaseTool>
    );
  },
});

export {
  listNotificationsHandler,
  markNotificationsDoneHandler,
  markNotificationsSeenHandler,
  muteNotificationsHandler,
};
