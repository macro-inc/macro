import {
  subscribeFaviconUpdates,
  updateFavicon,
  updateFaviconFromBroadcast,
} from '@app/util/favicon';
import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { useReactiveColorString } from '../../block-theme/signals/themeReactive';
import { useGlobalNotificationSource } from './GlobalAppState';

export function ReactiveFavicon() {
  const [showNotificationBadge, setShowNotificationBadge] = createSignal(false);
  const [isAppFocused, setIsAppFocused] = createSignal(!document.hidden);

  const globalNotifications = useGlobalNotificationSource();

  // Remove notification badge when app is focused
  const handleVisibilityChange = () => {
    setIsAppFocused(!document.hidden);
    if (!document.hidden) {
      setShowNotificationBadge(false);
    }
  };

  onMount(() => {
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const unsubscribeNotifications = globalNotifications.subscribe(() => {
      if (!isAppFocused()) {
        setShowNotificationBadge(true);
      }
    });

    // Listen for favicon updates from other tabs
    const unsubscribeFavicon = subscribeFaviconUpdates((message) => {
      updateFaviconFromBroadcast(
        message.faviconColor,
        message.badgeColor,
        message.hasBadge
      );
    });

    onCleanup(() => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      unsubscribeNotifications();
      unsubscribeFavicon();
    });
  });

  const accentColor = useReactiveColorString('a0');
  const badgeColor = useReactiveColorString('a1');

  createEffect(() => {
    updateFavicon(accentColor(), badgeColor(), showNotificationBadge());
  });

  return null;
}
