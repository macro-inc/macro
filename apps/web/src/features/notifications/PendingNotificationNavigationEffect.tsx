import { globalSplitManager } from '@app/signal/splitLayout';
import type {
  SplitEventWithType,
  SplitManager,
} from '@components/app/split-layout/layoutManager';
import { toast } from '@core/component/Toast/Toast';
import {
  type NotificationSource,
  openNotificationFromId,
  pendingNotificationNavigationId,
  setPendingNotificationNavigationId,
} from '@notifications';
import { createEffect, createSignal, onCleanup } from 'solid-js';

type NavigationAttempt = {
  notificationId: string;
  layoutManager: SplitManager;
  navigationVersion: number;
  eventAtStart: SplitEventWithType | undefined;
  settled: boolean;
};

export function usePendingNotificationNavigationEffect(
  notificationSource: NotificationSource
) {
  const [retryRevision, setRetryRevision] = createSignal(0);
  let disposed = false;
  let activeAttempt: NavigationAttempt | undefined;

  onCleanup(() => {
    disposed = true;
    activeAttempt = undefined;
  });

  createEffect(() => {
    retryRevision();
    const notificationId = pendingNotificationNavigationId();
    const layoutManager = globalSplitManager();
    const navigationReady = layoutManager?.contentNavigationReady() ?? false;
    const navigationVersion = layoutManager?.contentNavigationVersion() ?? 0;
    const currentEvent = layoutManager?.events();

    if (!notificationId || !layoutManager || !navigationReady) {
      activeAttempt = undefined;
      return;
    }

    if (
      activeAttempt?.notificationId === notificationId &&
      activeAttempt.layoutManager === layoutManager &&
      activeAttempt.navigationVersion === navigationVersion
    ) {
      // Do not overlap a fetch/open. Once it settles without being applied,
      // retry only after reconciliation changes the live layout.
      if (
        !activeAttempt.settled ||
        activeAttempt.eventAtStart === currentEvent
      ) {
        return;
      }
    }

    const attempt: NavigationAttempt = {
      notificationId,
      layoutManager,
      navigationVersion,
      eventAtStart: currentEvent,
      settled: false,
    };
    activeAttempt = attempt;

    const isCurrentAttempt = () =>
      !disposed &&
      activeAttempt === attempt &&
      pendingNotificationNavigationId() === notificationId &&
      globalSplitManager() === layoutManager &&
      layoutManager.contentNavigationReady() &&
      layoutManager.contentNavigationVersion() === navigationVersion;

    const onApplied = () => {
      if (!isCurrentAttempt()) return;
      activeAttempt = undefined;
      setPendingNotificationNavigationId(undefined);
    };

    void openNotificationFromId(
      notificationId,
      layoutManager,
      notificationSource,
      { canOpen: isCurrentAttempt, onApplied }
    ).match(
      () => {
        if (!isCurrentAttempt()) return;
        attempt.settled = true;
        if (layoutManager.events() !== attempt.eventAtStart) {
          setRetryRevision((revision) => revision + 1);
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
          layoutManager.contentNavigationVersion() !== navigationVersion
        ) {
          return;
        }
        setPendingNotificationNavigationId(undefined);
        toast.failure('Failed to open notification.');
      }
    );
  });
}
