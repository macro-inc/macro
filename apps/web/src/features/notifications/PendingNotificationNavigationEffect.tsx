import { globalSplitManager, globalSplitRouter } from '@app/signal/splitLayout';
import { toast } from '@core/component/Toast/Toast';
import {
  type NotificationSource,
  openNotificationFromId,
  pendingNotificationNavigationId,
  setPendingNotificationNavigationId,
} from '@notifications';
import { createEffect, on, onCleanup } from 'solid-js';

export function usePendingNotificationNavigationEffect(
  notificationSource: NotificationSource
) {
  createEffect(
    on(
      [pendingNotificationNavigationId, globalSplitManager, globalSplitRouter],
      ([notificationId, layoutManager, router]) => {
        if (!notificationId || !layoutManager || !router) return;
        // Reminder intents need the route host so feature-flag loading is
        // handled reactively instead of falling through to an ungated legacy
        // component mount. Waiting for the router's existing lifecycle also
        // guarantees navigate has a reconciled source entry to accept.
        let current = true;
        onCleanup(() => {
          current = false;
        });

        const canOpen = () =>
          current &&
          pendingNotificationNavigationId() === notificationId &&
          globalSplitManager() === layoutManager &&
          globalSplitRouter() === router &&
          router.isReady() &&
          (() => {
            const currentSourceId = layoutManager.activeSplitId();
            return Boolean(currentSourceId && router.entry(currentSourceId));
          })();

        void (async () => {
          await router.settled();
          if (!canOpen()) return;

          await openNotificationFromId(
            notificationId,
            layoutManager,
            notificationSource,
            { canOpen }
          ).match(
            () => {
              if (!current) return;
              if (
                pendingNotificationNavigationId() === notificationId &&
                globalSplitManager() === layoutManager &&
                globalSplitRouter() === router
              ) {
                setPendingNotificationNavigationId(undefined);
              }
            },
            (error) => {
              if (!current || error.tag === 'NavigationDeferredError') return;
              if (
                pendingNotificationNavigationId() !== notificationId ||
                globalSplitManager() !== layoutManager ||
                globalSplitRouter() !== router
              ) {
                return;
              }
              setPendingNotificationNavigationId(undefined);
              toast.failure('Failed to open notification.');
            }
          );
        })();
      }
    )
  );
}
