import Check from '@phosphor-icons/core/regular/check.svg';
import List from '@phosphor-icons/core/regular/list.svg';
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
};

const formatList = (items: string[]) => {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
};

const formatNotificationFilters = (filters: ListNotificationsTool) => {
  const statusFilters = [filters.done ? 'done' : 'not done'];
  if (filters.seen != null) {
    statusFilters.push(filters.seen ? 'seen' : 'unseen');
  }

  let text = `filtered by ${formatList(statusFilters)}`;

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
          <div class="flex min-w-0 items-center justify-between gap-3">
            <span>Read notifications</span>
            <Show when={statusText()}>
              {(text) => (
                <span class="shrink-0 text-xs text-ink-extra-muted">
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

export {
  listNotificationsHandler,
  markNotificationsDoneHandler,
  markNotificationsSeenHandler,
};
