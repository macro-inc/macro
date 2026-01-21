import { updateFavicon } from '@app/util/favicon';
import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { themeReactive } from '../../block-theme/signals/themeReactive';
import { useGlobalNotificationSource } from './GlobalAppState';

export function ReactiveFavicon() {
  const globalNotifications = useGlobalNotificationSource();
  const [showNotyBadge, setShowNotyBadge] = createSignal(false);
  const [isAppFocused, setIsAppFocused] = createSignal(true);

  // Remove notification badge when app is focused
  const handleVisibilityChange = () => {
    setIsAppFocused(!document.hidden);
    if (!document.hidden) {
      setShowNotyBadge(false);
    }
  };
  onMount(() =>
    document.addEventListener('visibilitychange', handleVisibilityChange)
  );
  onCleanup(() =>
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  );

  // On new notification, show badge if app not focused
  globalNotifications.subscribe(() => {
    if (!isAppFocused()) {
      setShowNotyBadge(true);
    }
  });

  const {
    l: accentLightness,
    c: accentChroma,
    h: accentHue,
  } = themeReactive.a0;
  const { l: badgeLightness, c: badgeChroma, h: badgeHue } = themeReactive.a1;

  createEffect(() => {
    const accentColor = `oklch(${accentLightness[0]()} ${accentChroma[0]()} ${accentHue[0]()}deg)`;
    const badgeColor = `oklch(${badgeLightness[0]()} ${badgeChroma[0]()} ${badgeHue[0]()}deg)`;

    updateFavicon(accentColor, badgeColor, showNotyBadge());
  });
  return null;
}
