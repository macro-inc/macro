import { useSplitLayout } from '@app/component/split-layout/layout';
import { UserIcon } from '@core/component/UserIcon';
import SparkleIcon from '@icon/fill/sparkle-fill.svg';
import ChatIcon from '@icon/regular/chat-circle.svg';
import CheckIcon from '@icon/regular/check.svg';
import AtIcon from '@icon/regular/at.svg';
import CaretRightIcon from '@icon/regular/caret-right.svg';
import { useUserNotificationsQuery } from '@queries/notification/user-notifications';
import {
  getNotificationAction,
  getNotificationTargetName,
} from '@notifications/notification-metadata';
import { Button, cn, Surface } from '@ui';
import { createMemo, createSignal, For, onMount, Show } from 'solid-js';

const LAST_VISIT_KEY = 'macro:dashboard:last-visit';

function getLastVisit(): Date {
  const stored = localStorage.getItem(LAST_VISIT_KEY);
  if (stored) {
    const date = new Date(stored);
    if (!isNaN(date.getTime())) {
      return date;
    }
  }
  const twoHoursAgo = new Date();
  twoHoursAgo.setHours(twoHoursAgo.getHours() - 2);
  return twoHoursAgo;
}

function setLastVisit() {
  localStorage.setItem(LAST_VISIT_KEY, new Date().toISOString());
}

function formatTimeSince(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) return `${diffDays}d`;
  if (diffHours > 0) return `${diffHours}h`;
  if (diffMins > 0) return `${diffMins}m`;
  return 'just now';
}

interface DigestItem {
  id: string;
  icon: 'message' | 'task' | 'mention';
  text: string;
  senderId?: string;
  entityType?: string;
  entityId?: string;
}

export function SmartDigestSection() {
  const { openWithSplit } = useSplitLayout();
  const [lastVisit] = createSignal(getLastVisit());
  const [isVisible, setIsVisible] = createSignal(false);
  const [isDismissed, setIsDismissed] = createSignal(false);

  onMount(() => {
    setTimeout(() => setIsVisible(true), 100);
    const updateVisitTimeout = setTimeout(() => setLastVisit(), 5000);
    return () => clearTimeout(updateVisitTimeout);
  });

  const notificationsQuery = useUserNotificationsQuery({ limit: 50 });

  const digestItems = createMemo((): DigestItem[] => {
    const items = notificationsQuery.data ?? [];
    const sinceLastVisit = items.filter(
      (n) => new Date(n.created_at) > lastVisit()
    );

    const result: DigestItem[] = [];

    const messages = sinceLastVisit.filter(
      (n) =>
        n.notification_metadata.tag.includes('message') ||
        n.notification_metadata.tag.includes('channel')
    );
    if (messages.length > 0) {
      const channels = new Set(
        messages.map((m) => getNotificationTargetName(m)).filter(Boolean)
      );
      if (channels.size > 0) {
        result.push({
          id: 'messages',
          icon: 'message',
          text: `${messages.length} new message${messages.length > 1 ? 's' : ''} in ${Array.from(channels).slice(0, 2).join(', ')}${channels.size > 2 ? ` +${channels.size - 2} more` : ''}`,
          entityType: messages[0]?.entity_type,
          entityId: messages[0]?.entity_id,
        });
      }
    }

    const completedTasks = sinceLastVisit.filter(
      (n) =>
        n.notification_metadata.tag.includes('task') &&
        (getNotificationAction(n)?.includes('completed') ||
          getNotificationAction(n)?.includes('done'))
    );
    if (completedTasks.length > 0) {
      const firstTask = completedTasks[0];
      result.push({
        id: 'tasks',
        icon: 'task',
        text:
          completedTasks.length === 1
            ? `${getNotificationTargetName(firstTask) || 'A task'} was completed`
            : `${completedTasks.length} tasks were completed`,
        senderId: firstTask?.sender_id ?? undefined,
        entityType: firstTask?.entity_type,
        entityId: firstTask?.entity_id,
      });
    }

    const mentions = sinceLastVisit.filter((n) =>
      n.notification_metadata.tag.includes('mention')
    );
    if (mentions.length > 0) {
      result.push({
        id: 'mentions',
        icon: 'mention',
        text: `You were mentioned in ${mentions.length} ${mentions.length === 1 ? 'place' : 'places'}`,
        entityType: mentions[0]?.entity_type,
        entityId: mentions[0]?.entity_id,
      });
    }

    return result.slice(0, 4);
  });

  const handleItemClick = (item: DigestItem) => {
    if (item.entityType === 'document') {
      openWithSplit({ type: 'md', id: item.entityId! });
    } else if (item.entityType === 'chat') {
      openWithSplit({ type: 'chat', id: item.entityId! });
    } else if (item.entityType === 'channel') {
      openWithSplit({ type: 'channel', id: item.entityId! });
    } else {
      openWithSplit({ type: 'component', id: 'inbox' });
    }
  };

  const handleCatchUp = () => {
    openWithSplit({ type: 'component', id: 'inbox' });
  };

  const timeSince = () => formatTimeSince(lastVisit());

  if (isDismissed()) return null;

  return (
    <Show when={digestItems().length > 0}>
      <div
        class={cn(
          'transition-all duration-500 ease-out',
          isVisible()
            ? 'opacity-100 translate-y-0'
            : 'opacity-0 -translate-y-4'
        )}
      >
        <Surface
          depth={2}
          class="relative overflow-hidden p-4"
        >
          {/* Subtle animated gradient background */}
          <div
            class="absolute inset-0 opacity-[0.03] pointer-events-none"
            style={{
              background:
                'linear-gradient(135deg, var(--color-accent) 0%, var(--color-chat) 50%, var(--color-task) 100%)',
            }}
          />

          <div class="relative">
            {/* Header */}
            <div class="flex items-center justify-between mb-3">
              <div class="flex items-center gap-2">
                <div class="size-6 rounded-lg bg-gradient-to-br from-accent/20 to-chat/20 flex items-center justify-center">
                  <SparkleIcon class="size-3.5 text-accent" />
                </div>
                <div>
                  <h3 class="text-sm font-semibold text-ink">
                    Since you've been away
                  </h3>
                  <p class="text-xs text-ink-muted">{timeSince()} ago</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsDismissed(true)}
                class="text-xs text-ink-muted hover:text-ink transition-colors"
              >
                Dismiss
              </button>
            </div>

            {/* Items */}
            <div class="flex flex-col gap-1 mb-3">
              <For each={digestItems()}>
                {(item, index) => (
                  <button
                    type="button"
                    onClick={() => handleItemClick(item)}
                    class={cn(
                      'flex items-center gap-3 px-2 py-2 -mx-2 rounded-lg text-left',
                      'hover:bg-ink/5 transition-all duration-200',
                      'opacity-0 animate-[fadeSlideIn_0.3s_ease-out_forwards]'
                    )}
                    style={{
                      'animation-delay': `${200 + index() * 100}ms`,
                    }}
                  >
                    <Show
                      when={item.senderId}
                      fallback={
                        <div
                          class={cn(
                            'size-7 rounded-full flex items-center justify-center shrink-0',
                            item.icon === 'message' && 'bg-chat/10 text-chat',
                            item.icon === 'task' && 'bg-task/10 text-task',
                            item.icon === 'mention' && 'bg-accent/10 text-accent'
                          )}
                        >
                          <Show when={item.icon === 'message'}>
                            <ChatIcon class="size-3.5" />
                          </Show>
                          <Show when={item.icon === 'task'}>
                            <CheckIcon class="size-3.5" />
                          </Show>
                          <Show when={item.icon === 'mention'}>
                            <AtIcon class="size-3.5" />
                          </Show>
                        </div>
                      }
                    >
                      <UserIcon id={item.senderId!} size="sm" suppressClick />
                    </Show>
                    <span class="flex-1 text-sm text-ink truncate">
                      {item.text}
                    </span>
                    <CaretRightIcon class="size-4 text-ink-extra-muted shrink-0" />
                  </button>
                )}
              </For>
            </div>

            {/* Action */}
            <Button
              variant="base"
              size="sm"
              onClick={handleCatchUp}
              class="w-full justify-center gap-1.5 bg-ink/5 hover:bg-ink/10"
            >
              <span>Catch up</span>
              <CaretRightIcon class="size-3.5" />
            </Button>
          </div>
        </Surface>
      </div>
    </Show>
  );
}
