import { openEntityInSplitFromUnifiedList } from '@app/features/next-soup/utils';
import type { SplitHandle } from '@components/app/split-layout/layoutManager';
import { fireAndForget } from '@core/util/fireAndForget';
import type { NotificationInboxRow } from './context/notifications-inbox-context';

/**
 * Open what a notification row is about, at the notification's location
 * (the thread, comment or message the row's newest notification names), in
 * this split or a new one.
 */
export function openNotificationInSplit(
  row: NotificationInboxRow,
  options: { newSplit: boolean; splitHandle: SplitHandle }
) {
  fireAndForget(
    openEntityInSplitFromUnifiedList(row.content.entity, {
      openInNewSplit: options.newSplit,
      splitHandle: options.splitHandle,
    }),
    'notifications-inbox'
  );
}
