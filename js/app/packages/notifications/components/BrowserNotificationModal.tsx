import Bell from '@icon/regular/bell.svg';
import { toast } from '@core/component/Toast/Toast';
import { useTutorialCompleted } from '@core/context/user';
import { useIsAuthenticated } from '@queries/auth';
import { createEffect } from 'solid-js';
import { useNotificationSettings } from '../notification-settings';

export const BrowserNotificationModal = () => {
  const settings = useNotificationSettings();
  const isAuthenticated = useIsAuthenticated();
  const tutorialCompleted = useTutorialCompleted();

  if (!settings.isSupported) return null;

  let shown = false;

  createEffect(() => {
    if (shown) return;
    if (import.meta.env.DEV) return;
    if (!settings.shouldPrompt()) return;
    if (!isAuthenticated()) return;
    if (!tutorialCompleted()) return;

    shown = true;

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
              settings.dismissPrompt();
              toast.dismiss(toastId);
            },
          },
          {
            label: 'Enable',
            onClick: async () => {
              try {
                await settings.toggle(true);
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
};
