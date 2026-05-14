import { useSplitLayout } from '@app/component/split-layout/layout';
import { UserIcon } from '@core/component/UserIcon';
import { StaticMarkdown, StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { formatRelativeDate } from '@core/util/time';
import ClockCounterClockwiseIcon from '@icon/regular/clock-counter-clockwise.svg';
import FileIcon from '@icon/regular/file.svg';
import ChatIcon from '@icon/regular/chat-circle.svg';
import CheckIcon from '@icon/regular/check.svg';
import { DisplayName } from '@entity';
import { useUserNotificationsQuery } from '@queries/notification/user-notifications';
import {
  getNotificationAction,
  getNotificationContent,
  getNotificationTargetName,
  shouldShowNotificationTarget,
} from '@notifications/notification-metadata';
import type { UnifiedNotification } from '@notifications/types';
import { createMemo, For, Match, Show, Switch } from 'solid-js';

import {
  DashboardEmptyState,
  DashboardSection,
} from '../dashboard-section';
import { DashboardSectionLoading } from '../dashboard-section-loading';

const ACTIVITY_LIMIT = 8;

interface ActivitySectionProps {
  class?: string;
}

export function ActivitySection(props: ActivitySectionProps) {
  return (
    <DashboardSection
      title="Activity"
      icon={<ClockCounterClockwiseIcon />}
      accent="note"
      class={props.class}
      fallback={<DashboardSectionLoading rows={4} />}
    >
      <ActivityContent />
    </DashboardSection>
  );
}

function ActivityItemIcon(props: { notification: UnifiedNotification }) {
  const tag = props.notification.notification_metadata.tag;

  return (
    <Switch fallback={<FileIcon class="size-3.5" />}>
      <Match when={tag.includes('channel') || tag.includes('message')}>
        <ChatIcon class="size-3.5" />
      </Match>
      <Match when={tag.includes('task')}>
        <CheckIcon class="size-3.5" />
      </Match>
      <Match when={tag.includes('document') || tag.includes('comment')}>
        <FileIcon class="size-3.5" />
      </Match>
    </Switch>
  );
}

function ActivityRow(props: { notification: UnifiedNotification }) {
  const { openWithSplit } = useSplitLayout();
  const action = () => getNotificationAction(props.notification);
  const content = () => getNotificationContent(props.notification);
  const targetName = () => getNotificationTargetName(props.notification);
  const showTarget = () => shouldShowNotificationTarget(props.notification);

  const handleClick = () => {
    const entityType = props.notification.entity_type;
    const entityId = props.notification.entity_id;

    if (entityType === 'document') {
      openWithSplit({ type: 'md', id: entityId });
    } else if (entityType === 'chat') {
      openWithSplit({ type: 'chat', id: entityId });
    } else if (entityType === 'channel') {
      openWithSplit({ type: 'channel', id: entityId });
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      class="flex items-start gap-3 py-2.5 px-3 w-full text-left hover:bg-ink/5 rounded-lg transition-colors"
    >
      <div class="shrink-0">
        <Show
          when={props.notification.sender_id}
          fallback={
            <div class="size-7 rounded-full bg-ink/10 flex items-center justify-center">
              <ActivityItemIcon notification={props.notification} />
            </div>
          }
        >
          <UserIcon id={props.notification.sender_id!} size="sm" suppressClick />
        </Show>
      </div>
      <div class="flex-1 min-w-0 flex flex-col gap-0.5">
        <div class="text-sm text-ink line-clamp-2">
          <Show when={props.notification.sender_id}>
            <span class="font-medium">
              <DisplayName id={props.notification.sender_id!} format="firstName" />
            </span>
            <span class="text-ink-muted"> {action()}</span>
          </Show>
          <Show when={!props.notification.sender_id}>
            <span class="text-ink-muted">{action()}</span>
          </Show>
          <Show when={showTarget() && targetName()}>
            <span class="font-medium"> {targetName()}</span>
          </Show>
          <Show when={content()}>
            <span class="text-ink-muted"> · </span>
            <StaticMarkdownContext>
              <StaticMarkdown markdown={content()!} />
            </StaticMarkdownContext>
          </Show>
        </div>
        <p class="text-xs text-ink-extra-muted">
          {formatRelativeDate(props.notification.created_at)}
        </p>
      </div>
    </button>
  );
}

function ActivityContent() {
  const notificationsQuery = useUserNotificationsQuery({
    limit: ACTIVITY_LIMIT,
  });

  const activities = createMemo(() => {
    const items = notificationsQuery.data ?? [];
    return items.slice(0, ACTIVITY_LIMIT);
  });

  return (
    <Show
      when={activities().length > 0}
      fallback={
        <DashboardEmptyState
          icon={<ClockCounterClockwiseIcon />}
          title="No recent activity"
          description="Activity from your workspace will appear here"
        />
      }
    >
      <div class="flex flex-col max-h-96 overflow-y-auto -m-3">
        <For each={activities()}>
          {(notification) => <ActivityRow notification={notification} />}
        </For>
      </div>
    </Show>
  );
}
