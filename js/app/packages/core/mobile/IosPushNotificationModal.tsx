import { isPlatform } from '@core/util/platform';
import { useNotificationSettings } from '@notifications/notification-settings';
import { useIsAuthenticated } from '@queries/auth';
import { Button, Dialog, Surface } from '@ui';
import { createMemo, Show } from 'solid-js';

const DEBUG_FORCE_OPEN = false;

export function IosPushNotificationModal() {
  if (!isPlatform('ios')) return null;

  const settings = useNotificationSettings();
  const isAuthenticated = useIsAuthenticated();

  if (!settings.isSupported) return null;

  const shouldShow = createMemo(
    () => DEBUG_FORCE_OPEN || (settings.shouldPrompt() && isAuthenticated())
  );

  return (
    <Show when={shouldShow()}>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) settings.dismissPrompt();
        }}
        class="w-[90%]"
      >
        <Surface depth={2} active>
          <div class="*:max-h-[75vh]">
            <div class="flex flex-col gap-4 px-4 py-6">
              <Dialog.Title class="text-lg font-semibold text-ink">
                Enable Push Notifications
              </Dialog.Title>
              <Dialog.Description class="text-sm text-ink-extra-muted">
                Get notified about new messages, mentions, comments, and emails.
              </Dialog.Description>
              <div class="flex gap-2 w-full justify-end pt-2">
                <Dialog.CloseButton class="text-sm text-ink-muted hover:text-ink px-3 py-1.5">
                  Later
                </Dialog.CloseButton>
                <Button
                  variant="active"
                  size="sm"
                  class="text-sm"
                  onClick={async () => {
                    try {
                      await settings.toggle(true);
                    } catch (error) {
                      console.error('Failed to enable notifications:', error);
                    }
                  }}
                >
                  Enable
                </Button>
              </div>
            </div>
          </div>
        </Surface>
      </Dialog>
    </Show>
  );
}
