import { updateFavicon } from '@app/util/favicon';
import { createCrossTabBus } from '@core/cross-tab/cross-tab-bus';
import { useReactiveColorString } from '@theme/signals/themeReactive';
import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { match, P } from 'ts-pattern';
import { useGlobalNotificationSource } from './GlobalAppState';

type BadgeMessage = {
  hasBadge: boolean;
  /**
   * Publish time. Not read by subscribers; it makes each payload unique so
   * the bus's storage fallback fires (see `cross-tab-bus.ts`). Optional so
   * payloads from tabs still on a pre-bus bundle, which omit it, parse.
   */
  sentAt?: number;
};

const badgeBus = createCrossTabBus<BadgeMessage>({
  channelName: 'macro-favicon-badge',
  storageKey: 'macro.favicon-badge',
  parse: (value) =>
    match(value)
      .with({ hasBadge: P.boolean }, ({ hasBadge }) => ({ hasBadge }))
      .otherwise(() => null),
});

export function ReactiveFavicon() {
  const [showNotificationBadge, setShowNotificationBadge] = createSignal(false);
  const [isAppFocused, setIsAppFocused] = createSignal(!document.hidden);

  const globalNotifications = useGlobalNotificationSource();

  const accentColor = useReactiveColorString('a0');
  const badgeColor = useReactiveColorString('a0');

  const postBadgeMessage = (hasBadge: boolean) => {
    badgeBus.publish({ hasBadge, sentAt: Date.now() });
  };

  // Remove notification badge when app is focused
  const handleVisibilityChange = () => {
    setIsAppFocused(!document.hidden);
    if (!document.hidden) {
      setShowNotificationBadge(false);
      postBadgeMessage(false);
    }
  };

  onMount(() => {
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Sync badge state across tabs. Publishing also delivers locally, which
    // just re-sets the value the publisher already set.
    const unsubscribeBadgeMessages = badgeBus.subscribe((message) => {
      setShowNotificationBadge(message.hasBadge);
    });

    const unsubscribeNotifications = globalNotifications.subscribe(() => {
      if (!isAppFocused()) {
        setShowNotificationBadge(true);
        postBadgeMessage(true);
      }
    });

    onCleanup(() => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      unsubscribeBadgeMessages();
      unsubscribeNotifications();
    });
  });

  createEffect(() => {
    updateFavicon(accentColor(), badgeColor(), showNotificationBadge());
  });

  return null;
}
