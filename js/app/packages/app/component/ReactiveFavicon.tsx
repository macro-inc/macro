import {
  addBadgeNotification,
  removeBadgeNotifications,
} from '@app/signal/sidebarBadges';
import { globalSplitManager } from '@app/signal/splitLayout';
import { updateFavicon } from '@app/util/favicon';
import { notificationToSidebarId } from '@app/util/notification-sidebar-id';
import { runRefocusPulses } from '@app/util/refocus-highlight';
import { ENABLE_REFOCUS_HIGHLIGHT } from '@core/constant/featureFlags';
import type { UnifiedNotification } from '@notifications';
import { createBroadcastChannel } from '@solid-primitives/broadcast-channel';
import { createEffect, createSignal, on, onCleanup, onMount } from 'solid-js';
import { useReactiveColorString } from '../../theme/signals/themeReactive';
import { useGlobalNotificationSource } from './GlobalAppState';

type BadgeMessage = { hasBadge: boolean };

export function ReactiveFavicon() {
  const [showNotificationBadge, setShowNotificationBadge] = createSignal(false);
  const [isAppFocused, setIsAppFocused] = createSignal(!document.hidden);
  const pendingNotifications: UnifiedNotification[] = [];

  const globalNotifications = useGlobalNotificationSource();

  const accentColor = useReactiveColorString('a0');
  const badgeColor = useReactiveColorString('a0');

  // Create broadcast channel for badge state sync across tabs
  const { message: badgeMessage, postMessage: postBadgeMessage } =
    createBroadcastChannel<BadgeMessage>('macro-favicon-badge');

  // Listen for badge updates from other tabs
  createEffect(
    on(
      badgeMessage,
      (msg) => {
        if (msg) {
          setShowNotificationBadge(msg.hasBadge);
        }
      },
      { defer: true }
    )
  );

  // Remove notification badge when app is focused
  const handleVisibilityChange = () => {
    setIsAppFocused(!document.hidden);
    if (!document.hidden) {
      setShowNotificationBadge(false);
      postBadgeMessage({ hasBadge: false });
      const toProcess = pendingNotifications.splice(0);
      if (ENABLE_REFOCUS_HIGHLIGHT) {
        runRefocusPulses(toProcess, globalSplitManager());
      }
    }
  };

  onMount(() => {
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const unsubscribeNotifications = globalNotifications.subscribe(
      (newNotification) => {
        const sidebarId = notificationToSidebarId(newNotification);
        if (sidebarId) addBadgeNotification(sidebarId, newNotification.id);

        if (!isAppFocused()) {
          setShowNotificationBadge(true);
          postBadgeMessage({ hasBadge: true });
          pendingNotifications.push(newNotification);
        }
      }
    );

    onCleanup(() => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      unsubscribeNotifications();
    });
  });

  createEffect(() => {
    updateFavicon(accentColor(), badgeColor(), showNotificationBadge());
  });

  createEffect(() => {
    const viewedOrDone = globalNotifications
      .notifications()
      .filter((n) => n.viewed_at || n.done)
      .map((n) => n.id);
    if (viewedOrDone.length > 0) removeBadgeNotifications(viewedOrDone);
  });

  return null;
}
