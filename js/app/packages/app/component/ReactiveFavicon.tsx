import { updateFavicon } from '@app/util/favicon';
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

    const unsubscribe = globalNotifications.subscribe(() => {
      if (!isAppFocused()) {
        setShowNotificationBadge(true);
      }
    });

    onCleanup(() => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      unsubscribe();
    });
  });

  const accentColor = useReactiveColorString('a0');
  const badgeColor = useReactiveColorString('a1');

  createEffect(() => {
    updateFavicon(accentColor(), badgeColor(), showNotificationBadge());
  });

  return null;
}
