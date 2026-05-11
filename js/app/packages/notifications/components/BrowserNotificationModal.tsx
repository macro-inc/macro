import { toast } from '@core/component/Toast/Toast';
import { useTutorialCompleted } from '@core/context/user';
import { isPlatform } from '@core/util/platform';
import Bell from '@icon/regular/bell.svg';
import { useIsAuthenticated } from '@queries/auth';
import { createMemo, onMount, Show } from 'solid-js';
import {
  type SupportedNotificationSettings,
  useNotificationSettings,
} from '../notification-settings';

export const BrowserNotificationModal = () => {
  const settings = useNotificationSettings();
  const isAuthenticated = useIsAuthenticated();
  const tutorialCompleted = useTutorialCompleted();

  if (!settings.isSupported) return null;

  const shouldShow = createMemo(
    () =>
      !import.meta.env.DEV &&
      !isPlatform('ios') &&
      settings.shouldPrompt() &&
      isAuthenticated() &&
      !!tutorialCompleted()
  );

  return (
    <Show when={shouldShow()}>
      <NotificationToastTrigger settings={settings} />
    </Show>
  );
};

function NotificationToastTrigger(props: {
  settings: SupportedNotificationSettings;
}) {
  onMount(() => {
    const toastId = toast.custom(
      {
        title: 'Enable Browser Notifications',
        icon: Bell,
        color: 'var(--color-accent)',
        content: () => (
          <div class="text-xs text-ink-extra-muted">
            Get notified about new messages, mentions, comments, and emails.
          </div>
        ),
        actions: [
          {
            label: 'Hide',
            onClick: () => {
              props.settings.dismissPrompt();
              toast.dismiss(toastId);
            },
          },
          {
            label: 'Enable',
            onClick: async () => {
              try {
                await props.settings.toggle(true);
              } catch (error) {
                console.error('Failed to enable notifications:', error);
              }
              toast.dismiss(toastId);
            },
          },
        ],
      },
      { persistent: true }
    );
  });

  return null;
}
