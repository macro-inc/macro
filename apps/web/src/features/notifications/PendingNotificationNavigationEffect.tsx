import { globalSplitManager } from '@app/signal/splitLayout';
import type {
  SplitEventWithType,
  SplitManager,
} from '@components/app/split-layout/layoutManager';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  type NotificationSource,
  openNotificationFromId,
} from '@notifications';
import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';
import {
  finishNotificationNavigation,
  type NotificationNavigationIntent,
  pendingNotificationNavigation,
} from './notification-navigation-intent';
import { notificationOpenSpan } from './notification-open-trace';

type NavigationAttempt = {
  notificationId: string;
  intent: NotificationNavigationIntent;
  layoutManager: SplitManager;
  navigationVersion: number;
  eventAtStart: SplitEventWithType | undefined;
  settled: boolean;
  applied: boolean;
};

export function usePendingNotificationNavigationEffect(
  notificationSource: NotificationSource,
  recipientId: Accessor<string | undefined>
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
    const intent = pendingNotificationNavigation();
    const notificationId = intent?.notificationId;
    const account = recipientId();
    const layoutManager = globalSplitManager();
    const navigationReady = layoutManager?.contentNavigationReady() ?? false;
    const navigationVersion = layoutManager?.contentNavigationVersion() ?? 0;
    const currentEvent = layoutManager?.events();

    if (intent?.recipientId && account && intent.recipientId !== account) {
      activeAttempt = undefined;
      finishNotificationNavigation(intent, 'account_mismatch');
      return;
    }
    if (
      !intent ||
      !notificationId ||
      !layoutManager ||
      !navigationReady ||
      (intent.recipientId && !account)
    ) {
      activeAttempt = undefined;
      return;
    }

    if (
      activeAttempt?.intent === intent &&
      activeAttempt.layoutManager === layoutManager &&
      activeAttempt.navigationVersion === navigationVersion
    ) {
      // Do not overlap a fetch/open. Once it settles without being applied,
      // retry only after reconciliation changes the live layout.
      if (
        activeAttempt.applied ||
        !activeAttempt.settled ||
        activeAttempt.eventAtStart === currentEvent
      ) {
        return;
      }
    }

    const attempt: NavigationAttempt = {
      notificationId,
      intent,
      layoutManager,
      navigationVersion,
      eventAtStart: currentEvent,
      settled: false,
      applied: false,
    };
    activeAttempt = attempt;

    const isCurrentAttempt = () =>
      !disposed &&
      activeAttempt === attempt &&
      pendingNotificationNavigation() === intent &&
      (!intent.recipientId || recipientId() === intent.recipientId) &&
      globalSplitManager() === layoutManager &&
      layoutManager.contentNavigationReady() &&
      layoutManager.contentNavigationVersion() === navigationVersion;

    const onApplied = () => {
      if (!isCurrentAttempt()) return;
      // Keep the attempt in flight until native confirms receipt, so another
      // layout event cannot start a second navigation during that handshake.
      attempt.applied = true;
      finishNotificationNavigation(intent);
    };

    const open = () =>
      openNotificationFromId(
        notificationId,
        layoutManager,
        notificationSource,
        {
          canOpen: isCurrentAttempt,
          onApplied,
          ...(intent.target ? { target: intent.target } : {}),
        }
      );
    const span = notificationOpenSpan(notificationId);
    fireAndForget(
      (span ? span.run(open) : open()).match(
        () => {
          if (!isCurrentAttempt() || attempt.applied) return;
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
            pendingNotificationNavigation() !== intent ||
            globalSplitManager() !== layoutManager ||
            layoutManager.contentNavigationVersion() !== navigationVersion
          ) {
            return;
          }
          finishNotificationNavigation(intent, 'failed');
          toast.failure('Failed to open notification.');
        }
      ),
      'notification-navigation'
    );
  });
}
