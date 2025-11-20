import { TabContent } from '@core/component/TabContent';
import { Switch } from '@kobalte/core/switch';
import { Show } from 'solid-js';
import { usePlatformNotificationState } from '@notifications';

export function Notification() {
  const notificationState = usePlatformNotificationState();

  // this property is not reactive nor should it be
  if (notificationState === 'not-supported')
    return <NotificationNotSupported />;

  return (
    <TabContent title="Notifications">
      <div class="flex flex-col gap-2 max-w-64 select-none">
        <div class="flex items-center justify-between mt-2">
          <div class="text-sm">Notifications</div>
          <Switch
            checked={notificationState.permission.latest === 'granted'}
            onChange={(enabled) =>
              enabled
                ? notificationState.requestPermission()
                : notificationState.unregisterNotification()
            }
            class="focus-bracket-within"
          >
            <Switch.Input class="sr-only" />
            <Switch.Control class="mt-1 inline-flex h-6 w-11 hover:ring-1 hover:ring-edge rounded-full border-2 border-transparent transition-colors bg-edge focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 data-[checked]:bg-accent">
              <Switch.Thumb class="block h-5 w-5 rounded-full bg-dialog transition-transform data-[checked]:translate-x-5" />
            </Switch.Control>
          </Switch>
        </div>

        <div
          class="transition-all transition-discrete"
          classList={{
            'hidden opacity-0':
              notificationState.permission.latest !== 'granted',
            'block opacity-100 starting:opacity-0':
              notificationState.permission.latest === 'granted',
          }}
        >
          <Show when={import.meta.env.MODE === 'development'}>
            <div class="flex items-center justify-between mt-2 pl-2">
              <div class="text-sm">New Message</div>
              <Switch class="focus-bracket-within" disabled>
                <Switch.Input class="sr-only" />
                <Switch.Control class="mt-1 inline-flex h-6 w-11 hover:ring-1 hover:ring-edge rounded-full border-2 border-transparent transition-colors bg-edge focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 data-[checked]:bg-accent">
                  <Switch.Thumb class="block h-5 w-5 rounded-full bg-dialog transition-transform data-[checked]:translate-x-5" />
                </Switch.Control>
              </Switch>
            </div>
            <div class="flex items-center justify-between mt-2 pl-2">
              <div class="text-sm">@ Mention</div>
              <Switch class="focus-bracket-within" disabled>
                <Switch.Input class="sr-only" />
                <Switch.Control class="mt-1 inline-flex h-6 w-11 hover:ring-1 hover:ring-edge rounded-full border-2 border-transparent transition-colors bg-edge focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 data-[checked]:bg-accent">
                  <Switch.Thumb class="block h-5 w-5 rounded-full bg-dialog transition-transform data-[checked]:translate-x-5" />
                </Switch.Control>
              </Switch>
            </div>
            <div class="flex items-center justify-between mt-2 pl-2">
              <div class="text-sm">Shared Document</div>
              <Switch class="focus-bracket-within" disabled>
                <Switch.Input class="sr-only" />
                <Switch.Control class="mt-1 inline-flex h-6 w-11 hover:ring-1 hover:ring-edge rounded-full border-2 border-transparent transition-colors bg-edge focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 data-[checked]:bg-accent">
                  <Switch.Thumb class="block h-5 w-5 rounded-full bg-dialog transition-transform data-[checked]:translate-x-5" />
                </Switch.Control>
              </Switch>
            </div>
          </Show>
        </div>
      </div>
    </TabContent>
  );
}

function NotificationNotSupported() {
  return (
    <TabContent title="Notifications">
      <div class="flex flex-col gap-2 max-w-64 select-none">
        <div class="flex items-center justify-between mt-2">
          <div class="text-sm">Notifications</div>
          <span>Notifications are not supported on this device</span>
        </div>
      </div>
    </TabContent>
  );
}
