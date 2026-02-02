import { updateFavicon } from '@app/util/favicon';
import { createBroadcastChannel } from '@solid-primitives/broadcast-channel';
import { createEffect, createSignal, on, onCleanup, onMount } from 'solid-js';
import { useReactiveColorString } from '../../block-theme/signals/themeReactive';
import { useGlobalNotificationSource } from './GlobalAppState';

type BadgeMessage = { hasBadge: boolean };

export function ReactiveFavicon() {
  const [showNotificationBadge, setShowNotificationBadge] = createSignal(false);
  const [isAppFocused, setIsAppFocused] = createSignal(!document.hidden);

  const globalNotifications = useGlobalNotificationSource();

  const accentColor = useReactiveColorString('a0');
  const badgeColor = useReactiveColorString('a1');

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
    }
  };

  onMount(() => {
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const unsubscribeNotifications = globalNotifications.subscribe(() => {
      if (!isAppFocused()) {
        setShowNotificationBadge(true);
        postBadgeMessage({ hasBadge: true });
      }
    });

    onCleanup(() => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      unsubscribeNotifications();
    });
  });

  createEffect(() => {
    updateFavicon(accentColor(), badgeColor(), showNotificationBadge());
  });

  return null;
}
