import { openEntityInSplitFromUnifiedList } from '@app/features/next-soup/utils';
import { globalSplitManager } from '@app/signal/splitLayout';
import type { SplitHandle } from '@components/app/split-layout/layoutManager';
import { fireAndForget } from '@core/util/fireAndForget';
import { openNotification } from '@notifications';
import type { UnifiedNotification } from '@notifications/types';
import type { NotificationInboxRow } from './context/notifications-inbox-context';
import { agentTurnParams } from './primitives/notification-location';
import { rowEntity } from './primitives/row-entity';

type PasswordsVisibility = {
  enabled: () => boolean;
  teamId: () => string | undefined;
};

type OpenOptions = {
  newSplit: boolean;
  splitHandle: SplitHandle;
  passwords?: PasswordsVisibility;
};

function isPasswordRequest(notification: UnifiedNotification, teamId: string) {
  const metadata = notification.notification_metadata;
  if (metadata.tag !== 'password_access_requested') return false;
  const content = metadata.content;
  return (
    notification.notification_event_type === 'password_access_requested' &&
    notification.entity_type === 'team' &&
    notification.entity_id === teamId &&
    content?.teamId === teamId &&
    typeof content.itemId === 'string' &&
    content.itemId.trim().length > 0 &&
    typeof content.requestId === 'string' &&
    content.requestId.trim().length > 0
  );
}

/** Team groups only present requests for the currently available vault. Server ACLs remain authoritative. */
export function isVisibleInboxRow(
  row: NotificationInboxRow,
  passwords: PasswordsVisibility | undefined
) {
  if (row.content.entity.type !== 'team') return true;
  if (!passwords?.enabled()) return false;
  const teamId = passwords.teamId();
  if (!teamId || row.content.entity.id !== teamId) return false;
  return (
    row.content.notifications.length > 0 &&
    row.content.notifications.every((notification) =>
      isPasswordRequest(notification, teamId)
    )
  );
}

/**
 * Open one notification of a stack at its own location, as the app's other
 * notification lists do; one with nowhere of its own opens what its row is
 * about. An agent's turn is applied after the session opens.
 */
async function openStackNotification(
  row: NotificationInboxRow,
  notification: UnifiedNotification,
  options: OpenOptions
) {
  const entity = row.content.entity;
  const manager = globalSplitManager();
  const opened =
    manager &&
    (await openNotification(
      notification,
      manager,
      options.newSplit,
      {
        fileType: 'fileType' in entity ? entity.fileType : undefined,
        subType: 'subType' in entity ? entity.subType : undefined,
      },
      options.splitHandle
    ));
  if (!opened || opened.isErr()) {
    // Notification-only teams never fall back to a generic entity page.
    if (entity.type === 'team') return;
    await openEntityInSplitFromUnifiedList(rowEntity(row, notification), {
      openInNewSplit: options.newSplit,
      splitHandle: options.splitHandle,
    });
    return;
  }
  const params = agentTurnParams(notification);
  if (!params) return;
  const handle = await manager
    .getOrchestrator()
    ?.getBlockHandle(entity.id, 'agent');
  await handle?.goToLocationFromParams(params);
}

/**
 * Open what a notification row is about, at the notification's location
 * (the thread, comment or message the row's newest notification names), or at
 * one of its notifications when one is named, in this split or a new one.
 */
export function openNotificationInSplit(
  row: NotificationInboxRow,
  options: OpenOptions & { notification?: UnifiedNotification }
) {
  if (!isVisibleInboxRow(row, options.passwords)) return;
  if (
    row.content.entity.type === 'team' &&
    options.notification &&
    (!isPasswordRequest(options.notification, row.content.entity.id) ||
      !row.content.notifications.some(
        (notification) => notification.id === options.notification?.id
      ))
  )
    return;
  // A runtime or team has no page of its own: its newest notification opens
  // its target (Settings → Machines, or the vault item a request is about).
  const notification =
    options.notification ??
    (row.content.entity.type === 'harness' || row.content.entity.type === 'team'
      ? row.content.notifications[0]
      : undefined);
  fireAndForget(
    notification
      ? openStackNotification(row, notification, options)
      : openEntityInSplitFromUnifiedList(rowEntity(row), {
          openInNewSplit: options.newSplit,
          splitHandle: options.splitHandle,
        }),
    'notifications-inbox'
  );
}
