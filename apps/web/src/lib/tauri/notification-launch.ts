import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import {
  pendingNotificationNavigation,
  receiveNotificationTap,
} from '@notifications/notification-navigation-intent';
import { notificationOpenSpan } from '@notifications/notification-open-trace';
import { createEffect, on, onCleanup, onMount } from 'solid-js';
import {
  createPushApi,
  releaseNotificationCover,
  supportsNotificationLaunch,
} from './push-api';

const NOTIFICATION_COVER_MAX_WAIT_MS = 8000;

/** Keep every tap usable even when navigation or its acknowledgment stalls. */
export function useNotificationCoverTimeout(): void {
  onMount(() => {
    if (!supportsNotificationLaunch()) return;
    const startedAt = performance.now();
    const timeout = setTimeout(() => {
      // A tap received during startup owns its later deadline. Keep the
      // bootstrap fallback for launches that have not delivered an intent.
      if (pendingNotificationNavigation()?.deliveryId) return;
      const span = Telemetry.span('notification.cover_startup_fallback');
      span.setAttr('notification.cover.outcome', 'startup_timeout');
      span.setAttr('notification.cover.wait_ms', performance.now() - startedAt);
      span.event('notification.cover_timeout');
      span.end();
      fireAndForget(releaseNotificationCover(), 'notification-launch');
    }, NOTIFICATION_COVER_MAX_WAIT_MS);
    onCleanup(() => clearTimeout(timeout));
  });

  createEffect(
    on(pendingNotificationNavigation, (intent) => {
      if (!supportsNotificationLaunch() || !intent?.deliveryId) return;
      const timeout = setTimeout(() => {
        if (pendingNotificationNavigation() !== intent) return;
        notificationOpenSpan(intent.notificationId)?.event(
          'notification.cover_timeout'
        );
        // Revealing the app does not consume the durable destination. Native
        // can redeliver it, and a later route acknowledgment still completes it.
        fireAndForget(releaseNotificationCover(), 'notification-launch');
      }, NOTIFICATION_COVER_MAX_WAIT_MS);
      onCleanup(() => clearTimeout(timeout));
    })
  );
}

/** Read the native launch intent before the hash router can restore another page. */
export async function prepareNotificationLaunch(): Promise<void> {
  if (!supportsNotificationLaunch()) return;
  const api = createPushApi('ios');
  const span = Telemetry.span('notification.launch');
  let timeout: ReturnType<typeof setTimeout> | undefined;

  async function readPending(): Promise<'ready' | 'failed'> {
    try {
      await api.watch((event) => {
        receiveNotificationTap(event, api.acknowledge);
      });
      const pending = await api.pending();
      if (pending) receiveNotificationTap(pending, api.acknowledge);
      return 'ready';
    } catch (error) {
      // This can reject after startup has continued; still report the failure.
      Telemetry.error(error, { surface: 'notification-launch' });
      return 'failed';
    }
  }

  try {
    const outcome = await Promise.race([
      readPending(),
      new Promise<'timeout'>((resolve) => {
        timeout = setTimeout(() => resolve('timeout'), 1500);
      }),
    ]);
    span.setAttr('notification.launch.outcome', outcome);
    if (outcome !== 'ready') {
      // Revealing the app must not wait on another potentially stalled invoke.
      fireAndForget(releaseNotificationCover(), 'notification-launch');
    }
  } finally {
    clearTimeout(timeout);
    span.end();
  }

  // Only startup may reset the initial location. If the bridge settles after
  // the deadline, its tap stays in the normal account-checked navigation flow.
  if (!pendingNotificationNavigation()) return;
  const url = new URL(window.location.href);
  // BasePath verifies the account and chooses the notification route. Do not
  // restore a previous page while that identity is still unknown.
  url.hash = '/';
  window.history.replaceState(window.history.state, '', url);
}
