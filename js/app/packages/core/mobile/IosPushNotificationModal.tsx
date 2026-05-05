import { isPlatform } from '@core/util/platform';
import { useNotificationSettings } from '@notifications/notification-settings';
import { useIsAuthenticated } from '@queries/auth';
import { Backdrop, Button, Panel } from '@ui';
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
      <Backdrop
        open
        onOpenChange={(open) => {
          if (!open) settings.dismissPrompt();
        }}
        width="90%"
      >
        <Panel depth={2} active>
          <div class="*:max-h-[75vh]">
            <div class="flex flex-col gap-4 px-4 py-6">
              <Backdrop.Title class="text-lg font-semibold text-ink">
                Enable Push Notifications
              </Backdrop.Title>
              <Backdrop.Description class="text-sm text-ink-extra-muted">
                Get notified about new messages, mentions, comments, and emails.
              </Backdrop.Description>
              <div class="flex gap-2 w-full justify-end pt-2">
                <Backdrop.CloseButton class="text-sm text-ink-muted hover:text-ink px-3 py-1.5">
                  Later
                </Backdrop.CloseButton>
                <Button
                  variant="accent"
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
        </Panel>
      </Backdrop>
    </Show>
  );
}
