import { TabContent } from '@core/component/TabContent';
import { Switch } from '@kobalte/core/switch';
import { Show } from 'solid-js';
import {
  type SupportedNotificationSettings,
  useNotificationSettings,
} from '@notifications';

export function Notification() {
  const settings = useNotificationSettings();

  return (
    <Show
      when={settings.isSupported && settings}
      fallback={<NotificationNotSupported />}
    >
      {(s) => <NotificationSettings settings={s()} />}
    </Show>
  );
}

function NotificationSettings(props: {
  settings: SupportedNotificationSettings;
}) {
  return (
    <TabContent title="Notifications">
      <div class="flex flex-col gap-2 max-w-64 select-none">
        <div class="flex items-center justify-between mt-2">
          <div class="text-sm">Notifications</div>
          <Switch
            checked={props.settings.isEnabled()}
            onChange={props.settings.toggle}
            class="focus-bracket-within"
          >
            <Switch.Input class="sr-only" />
            <Switch.Control class="mt-1 inline-flex h-6 w-11 hover:ring-1 hover:ring-edge rounded-full border-2 border-transparent transition-colors bg-edge focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 data-[checked]:bg-accent">
              <Switch.Thumb class="block h-5 w-5 rounded-full bg-dialog transition-transform data-[checked]:translate-x-5" />
            </Switch.Control>
          </Switch>
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
