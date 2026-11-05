import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { useTutorialCompleted } from '@core/context/user';
import { isMobile } from '@core/mobile/isMobile';
import { isPlatform } from '@core/util/platform';
import Bell from '@icon/system/regular/bell.svg';
import { useIsAuthenticated } from '@queries/auth';
import { createMemo, onMount, Show } from 'solid-js';
import {
  type SupportedNotificationSettings,
  useNotificationSettings,
} from '../notification-settings';
import { notificationsBlockedMessage } from '../notifications-blocked-message';

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

/** Native apps ask for app notifications; only the web app uses the browser's. */
function promptTitle() {
  if (isPlatform('desktop')) return 'Enable Desktop Notifications';
  if (isPlatform('android')) return 'Enable Notifications';
  return 'Enable Browser Notifications';
}

function NotificationToastTrigger(props: {
  settings: SupportedNotificationSettings;
}) {
  onMount(() => {
    const toastId = toast.custom(
      {
        title: promptTitle(),
        dismissLabel: t('common.notNow'),
        icon: Bell,
        color: 'var(--color-accent)',
        content: () => (
          <div class="text-xs text-ink-extra-muted">
            Get notified about new messages, mentions, comments, and emails.
          </div>
        ),
        actions: [
          {
            label: 'Enable',
            onClick: async () => {
              try {
                await props.settings.toggle(true);
                if (!props.settings.isEnabled()) {
                  toast.failure(notificationsBlockedMessage());
                }
              } catch (error) {
                console.error('Failed to enable notifications:', error);
              }
              toast.dismiss(toastId);
            },
          },
        ],
      },
      {
        persistent: true,
        region: isMobile() ? 'mobile-prompt-region' : 'prompt-region',
        // Closing the prompt is a decline, so don't ask again on the next load.
        onUserDismiss: () => props.settings.dismissPrompt(),
      }
    );
  });

  return null;
}
