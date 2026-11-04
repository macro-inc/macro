import { openEntityInSplitFromUnifiedList } from '@app/features/next-soup/utils';
import { globalSplitManager } from '@app/signal/splitLayout';
import type { SplitHandle } from '@components/app/split-layout/layoutManager';
import { fireAndForget } from '@core/util/fireAndForget';
import { openNotification } from '@notifications';
import type { UnifiedNotification } from '@notifications/types';
import type { NotificationInboxRow } from './context/notifications-inbox-context';
import { agentTurnParams } from './primitives/notification-location';

type OpenOptions = { newSplit: boolean; splitHandle: SplitHandle };

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
    await openEntityInSplitFromUnifiedList(row.content.entityAt(notification), {
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
  fireAndForget(
    options.notification
      ? openStackNotification(row, options.notification, options)
      : openEntityInSplitFromUnifiedList(row.content.entity, {
          openInNewSplit: options.newSplit,
          splitHandle: options.splitHandle,
        }),
    'notifications-inbox'
  );
}
