import { SidePanel } from '@components/app/side-panel';
import { compareDateDesc } from '@core/util/date';
import { NotificationRow } from '@entity';
import type { UnifiedNotification } from '@notifications/types';
import { createMemo, For, Show } from 'solid-js';

type NotificationsProps = {
  notifications: UnifiedNotification[];
};

export function Notifications(props: NotificationsProps) {
  const notifications = createMemo(() =>
    [...props.notifications].sort((a, b) =>
      compareDateDesc(a.created_at, b.created_at)
    )
  );

  return (
    <Show
      when={notifications().length > 0}
      fallback={
        <div class="py-8 text-ink-muted text-sm text-center">
          No notifications found
        </div>
      }
    >
      <SidePanel.Card>
        <For each={notifications()}>
          {(notification) => <NotificationRow notification={notification} />}
        </For>
      </SidePanel.Card>
    </Show>
  );
}
