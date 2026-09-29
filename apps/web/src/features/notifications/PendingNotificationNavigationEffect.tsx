import { globalSplitManager, globalSplitRouter } from '@app/signal/splitLayout';
import { toast } from '@core/component/Toast/Toast';
import {
  type NotificationSource,
  openNotificationFromId,
  pendingNotificationNavigationId,
  setPendingNotificationNavigationId,
} from '@notifications';
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';

export function usePendingNotificationNavigationEffect(
  notificationSource: NotificationSource
) {
  const [routerRevision, setRouterRevision] = createSignal(0);
  let disposed = false;
  let activeAttempt:
    | {
        notificationId: string;
        layoutManager: NonNullable<ReturnType<typeof globalSplitManager>>;
        router: NonNullable<ReturnType<typeof globalSplitRouter>>;
      }
    | undefined;

  createEffect(() => {
    const router = globalSplitRouter();
    if (!router) return;
    const unsubscribe = router.subscribe(() =>
      setRouterRevision((revision) => revision + 1)
    );
    onCleanup(unsubscribe);
  });

  const routableSourceId = createMemo(() => {
    routerRevision();
    const layoutManager = globalSplitManager();
    const router = globalSplitRouter();
    const sourceId = layoutManager?.activeSplitId();
    if (!router?.isReady() || !sourceId || !router.entry(sourceId)) return;
    return sourceId;
  });

  onCleanup(() => {
    disposed = true;
    activeAttempt = undefined;
  });

  createEffect(
    on(
      [
        pendingNotificationNavigationId,
        globalSplitManager,
        globalSplitRouter,
        routableSourceId,
      ],
      ([notificationId, layoutManager, router, sourceId]) => {
        if (!notificationId || !layoutManager || !router || !sourceId) {
          activeAttempt = undefined;
          return;
        }
        // Reminder intents need the route host so feature-flag loading is
        // handled reactively instead of falling through to an ungated legacy
        // component mount. Router and manager signals keep the intent pending
        // until navigate has a reconciled source entry to accept.
        if (
          activeAttempt?.notificationId === notificationId &&
          activeAttempt.layoutManager === layoutManager &&
          activeAttempt.router === router
        ) {
          return;
        }

        const attempt = { notificationId, layoutManager, router };
        activeAttempt = attempt;

        const canOpen = () =>
          !disposed &&
          activeAttempt === attempt &&
          pendingNotificationNavigationId() === notificationId &&
          globalSplitManager() === layoutManager &&
          globalSplitRouter() === router &&
          router.isReady() &&
          (() => {
            const currentSourceId = layoutManager.activeSplitId();
            return Boolean(currentSourceId && router.entry(currentSourceId));
          })();

        void openNotificationFromId(
          notificationId,
          layoutManager,
          notificationSource,
          { canOpen }
        ).match(
          () => {
            if (activeAttempt !== attempt) return;
            activeAttempt = undefined;
            if (
              !disposed &&
              pendingNotificationNavigationId() === notificationId &&
              globalSplitManager() === layoutManager &&
              globalSplitRouter() === router
            ) {
              setPendingNotificationNavigationId(undefined);
            }
          },
          (error) => {
            if (activeAttempt !== attempt) return;
            activeAttempt = undefined;
            if (error.tag === 'NavigationDeferredError') return;
            if (
              disposed ||
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
      }
    )
  );
}
