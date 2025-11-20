import { useIsAuthenticated } from '@core/auth';
import { Dialog } from '@kobalte/core/dialog';
import { createMemo, createSignal, Show } from 'solid-js';
import { usePlatformNotificationState } from './PlatformNotificationProvider';

const DISMISSED_KEY = 'browser-notification-modal-dismissed';

function useBrowserNotificationModal() {
  const isAuthenticated = useIsAuthenticated();
  const notificationState = usePlatformNotificationState();
  const [isDismissed, setIsDismissed] = createSignal(
    !!localStorage.getItem(DISMISSED_KEY)
  );

  const shouldShow = createMemo(() => {
    if (notificationState === 'not-supported') {
      return false;
    }

    if (!isAuthenticated()) {
      return false;
    }

    if (isDismissed()) {
      return false;
    }

    const permission = notificationState.permission();
    return (
      permission !== undefined &&
      permission !== 'granted' &&
      permission !== 'disabled-in-ui'
    );
  });

  const handleEnableNotifications = async () => {
    if (notificationState === 'not-supported') {
      return;
    }

    try {
      await notificationState.requestPermission();
    } catch (error) {
      console.error('Failed to enable notifications:', error);
    }
  };

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, 'true');
    setIsDismissed(true);
  };

  return {
    shouldShow,
    handleEnableNotifications,
    handleDismiss,
    isSupported: notificationState !== 'not-supported',
  };
}

export const BrowserNotificationModal = () => {
  const { shouldShow, handleEnableNotifications, handleDismiss, isSupported } =
    useBrowserNotificationModal();

  return (
    <Show when={isSupported}>
      <Dialog open={shouldShow()} modal={true}>
        <Dialog.Portal>
          <Dialog.Overlay class="fixed inset-0 z-modal bg-modal-overlay" />
          <div class="fixed inset-0 z-modal w-screen h-screen flex items-center justify-center">
            <Dialog.Content class="flex items-center justify-center">
              <div class="pointer-events-auto max-w-xl bg-menu border border-edge w-lg h-fit p-2">
                <div class="w-full my-1">
                  <h2 class="text-xl mb-3">Enable Browser Notifications</h2>

                  <div class="mb-4">
                    <p class="text-ink-muted text-sm">
                      Get notified about new messages, mentions, comments, and
                      emails.
                    </p>
                  </div>
                  <div class="flex justify-end mt-2 tex-sm pt-2 gap-2">
                    <button
                      class="py-1 px-3 font-mono text-sm"
                      onClick={handleDismiss}
                    >
                      Not Now
                    </button>
                    <button
                      class="uppercase py-1 px-3 font-mono text-sm bg-accent text-menu"
                      onClick={handleEnableNotifications}
                    >
                      Enable
                    </button>
                  </div>
                </div>
              </div>
            </Dialog.Content>
          </div>
        </Dialog.Portal>
      </Dialog>
    </Show>
  );
};
