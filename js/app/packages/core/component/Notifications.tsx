import { SidePanel } from '@app/component/side-panel';
import type { Entity as EntityRef } from '@core/types';
import { compareDateDesc } from '@core/util/date';
import { NotificationRow } from '@entity';
import type { NotificationSource } from '@notifications';
import { createMemo, For, Show } from 'solid-js';

type NotificationsProps = {
  entity: EntityRef;
  notificationSource: NotificationSource;
};

export function Notifications(props: NotificationsProps) {
  const notifications = createMemo(() => {
    const entityNotifications =
      props.notificationSource.notificationsByEntity()[
        `${props.entity.type}@${props.entity.id}`
      ] ?? [];
    return [...entityNotifications].sort((a, b) =>
      compareDateDesc(a.created_at, b.created_at)
    );
  });

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
