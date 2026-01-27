import {
  broadcastBadge,
  subscribeBadgeUpdates,
  updateFavicon,
} from '@app/util/favicon';
import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { useReactiveColorString } from '../../block-theme/signals/themeReactive';
import { useGlobalNotificationSource } from './GlobalAppState';

export function ReactiveFavicon() {
  const [showNotificationBadge, setShowNotificationBadge] = createSignal(false);
  const [isAppFocused, setIsAppFocused] = createSignal(!document.hidden);

  const globalNotifications = useGlobalNotificationSource();

  const accentColor = useReactiveColorString('a0');
  const badgeColor = useReactiveColorString('a1');

  // Remove notification badge when app is focused
  const handleVisibilityChange = () => {
    setIsAppFocused(!document.hidden);
    if (!document.hidden) {
      setShowNotificationBadge(false);
      broadcastBadge(false);
    }
  };

  onMount(() => {
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const unsubscribeNotifications = globalNotifications.subscribe(() => {
      if (!isAppFocused()) {
        setShowNotificationBadge(true);
        broadcastBadge(true);
      }
    });

    // Listen for badge updates from other tabs
    const unsubscribeBadge = subscribeBadgeUpdates((hasBadge) => {
      setShowNotificationBadge(hasBadge);
    });

    onCleanup(() => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      unsubscribeNotifications();
      unsubscribeBadge();
    });
  });

  createEffect(() => {
    updateFavicon(accentColor(), badgeColor(), showNotificationBadge());
  });

  return null;
}
