import { Dialog } from '@kobalte/core/dialog';
import { createMemo } from 'solid-js';
import { useNotificationSettings } from '../notification-settings';
import { useIsAuthenticated } from '@queries/auth';

export const BrowserNotificationModal = () => {
  const settings = useNotificationSettings();

  const isAuthenticated = useIsAuthenticated();

  if (!settings.isSupported) return null;

  const shouldShow = createMemo(
    () => !import.meta.env.DEV && settings.shouldPrompt() && isAuthenticated()
  );

  const handleEnable = async () => {
    try {
      await settings.toggle(true);
    } catch (error) {
      console.error('Failed to enable notifications:', error);
    }
  };

  return (
    <Dialog open={shouldShow()} modal={true}>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-modal bg-modal-overlay" />
        <div class="fixed inset-0 z-modal w-screen h-screen flex items-center justify-center">
          <Dialog.Content class="flex items-center justify-center">
            <div class="pointer-events-auto max-w-[min(36rem,calc(100%-1rem))] bg-menu border border-edge w-lg h-fit p-2">
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
                    onClick={settings.dismissPrompt}
                  >
                    Not Now
                  </button>
                  <button
                    class="uppercase py-1 px-3 font-mono text-sm bg-accent text-menu"
                    onClick={handleEnable}
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
  );
};
