import { globalSplitManager, globalSplitRouter } from '@app/signal/splitLayout';
import { toast } from '@core/component/Toast/Toast';
import {
  type NotificationSource,
  openNotificationFromId,
  pendingNotificationNavigationId,
  setPendingNotificationNavigationId,
} from '@notifications';
import { createEffect, on } from 'solid-js';

export function usePendingNotificationNavigationEffect(
  notificationSource: NotificationSource
) {
  createEffect(
    on(
      [pendingNotificationNavigationId, globalSplitManager, globalSplitRouter],
      ([notificationId, layoutManager, router]) => {
        if (!notificationId) return;
        if (!layoutManager) return;
        // Reminder intents need the route host so feature-flag loading is
        // handled reactively instead of falling through to an ungated legacy
        // component mount. Waiting is harmless for every other destination.
        if (!router) return;

        setPendingNotificationNavigationId(undefined);

        void openNotificationFromId(
          notificationId,
          layoutManager,
          notificationSource
        ).match(
          () => {},
          () => {
            toast.failure('Failed to open notification.');
          }
        );
      }
    )
  );
}
