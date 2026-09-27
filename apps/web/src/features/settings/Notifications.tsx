import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { toast } from '@core/component/Toast/Toast';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import {
  EMAIL_DIGEST_NOTIFICATION_TYPE,
  NOTIFICATION_EVENT_GROUPS,
} from '@notifications/notification-event-catalog';
import { useNotificationSettings } from '@notifications/notification-settings';
import { openSnoozeEntityPicker } from '@notifications/SnoozeEntityDialog';
import { openSnoozeNotifications } from '@notifications/SnoozeNotificationsDialog';
import { queryReadyGate } from '@queries/gate';
import {
  useNotificationTypePreferencesQuery,
  useSetNotificationTypeEnabledMutation,
} from '@queries/notification/type-preferences';
import {
  useMutedEntitiesQuery,
  useUnmuteItemMutation,
} from '@queries/notification/unsubscribes';
import { ToggleSwitch } from '@ui';
import { For, getOwner, Show } from 'solid-js';
import { MutedItemRow } from './MutedItemRow';
import {
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from './primitives';

export function Notifications() {
  const dialogOwner = getOwner();
  const analytics = useAnalytics();
  const platformSettings = useNotificationSettings();
  const preferencesQuery = useNotificationTypePreferencesQuery();
  const setTypeEnabled = useSetNotificationTypeEnabledMutation();
  const mutedEntitiesQuery = useMutedEntitiesQuery({ limit: 100 });
  const unmuteItem = useUnmuteItemMutation();
  const prefsReady = () =>
    !preferencesQuery.isError && queryReadyGate(preferencesQuery);
  const mutedEntities = () =>
    !mutedEntitiesQuery.isError && queryReadyGate(mutedEntitiesQuery)
      ? mutedEntitiesQuery.data
      : [];

  const disabledTypes = () =>
    new Set(
      !preferencesQuery.isError && queryReadyGate(preferencesQuery)
        ? preferencesQuery.data.disabled_types
        : []
    );
  const snoozedEntities = () =>
    mutedEntities().filter((item) => item.snoozed_until);
  const permanentlyMutedEntities = () =>
    mutedEntities().filter((item) => !item.snoozed_until);

  const isTypeEnabled = (type: string) => !disabledTypes().has(type);

  const toggleType = async (type: string, enabled: boolean) => {
    try {
      await setTypeEnabled.mutateAsync({ type, enabled });
    } catch {
      toast.failure('Could not update notification preference');
    }
  };

  const unmuteEntity = async (item: { item_id: string; item_type: string }) => {
    try {
      await unmuteItem.mutateAsync(item);
    } catch {
      toast.failure('Could not unmute item');
    }
  };

  const pushLabel = isNativeMobilePlatform()
    ? 'Mobile notifications'
    : 'Desktop notifications';
  const pushDescription = isNativeMobilePlatform()
    ? 'Receive push notifications on this device'
    : 'Receive notifications on this browser or desktop app';

  return (
    <SettingsPage
      title="Notifications"
      description="Choose when you'll be notified. Inbox items always arrive unless you mute a type or an item."
    >
      <SettingsSection title="Delivery">
        <SettingsCard>
          <SettingsRow
            label="Inbox"
            description="Always on for types you have not muted"
          >
            <span class="text-sm text-ink-muted">Always on</span>
          </SettingsRow>
          <Show
            when={platformSettings.isSupported && platformSettings}
            fallback={
              <SettingsRow label={pushLabel} description={pushDescription}>
                <span class="text-sm text-ink-muted">
                  Not supported on this device
                </span>
              </SettingsRow>
            }
          >
            {(settings) => (
              <SettingsRow label={pushLabel} description={pushDescription}>
                <ToggleSwitch
                  size="md"
                  checked={settings().isEnabled()}
                  onChange={(enabled) => {
                    analytics.track('notifications_toggled');
                    void settings().toggle(enabled);
                  }}
                />
              </SettingsRow>
            )}
          </Show>
          <SettingsRow
            label="Email digest"
            description="A periodic email of unread notifications. Inbox items are unchanged."
          >
            <ToggleSwitch
              size="md"
              checked={isTypeEnabled(EMAIL_DIGEST_NOTIFICATION_TYPE)}
              disabled={!prefsReady()}
              onChange={(enabled) =>
                toggleType(EMAIL_DIGEST_NOTIFICATION_TYPE, enabled)
              }
            />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <For each={NOTIFICATION_EVENT_GROUPS}>
        {(group) => (
          <SettingsSection title={group.label}>
            <SettingsCard>
              <For each={group.events}>
                {(event) => (
                  <SettingsRow
                    label={event.label}
                    description={event.description}
                  >
                    <ToggleSwitch
                      size="md"
                      checked={isTypeEnabled(event.type)}
                      disabled={!prefsReady()}
                      onChange={(enabled) => toggleType(event.type, enabled)}
                    />
                  </SettingsRow>
                )}
              </For>
            </SettingsCard>
          </SettingsSection>
        )}
      </For>

      <SettingsSection
        title="Snoozed items"
        description="Notifications pause until the time you choose. Items stay visible in your inbox."
      >
        <SettingsCard>
          <Show when={mutedEntitiesQuery.isError}>
            <SettingsRow label="Could not load snoozed items">
              <button
                type="button"
                onClick={() => void mutedEntitiesQuery.refetch()}
              >
                Retry
              </button>
            </SettingsRow>
          </Show>
          <Show
            when={
              !mutedEntitiesQuery.isError && queryReadyGate(mutedEntitiesQuery)
            }
            fallback={
              !mutedEntitiesQuery.isError && (
                <SettingsRow label="Loading snoozed items…" />
              )
            }
          >
            <Show
              when={snoozedEntities().length > 0}
              fallback={
                <SettingsRow
                  label="Nothing snoozed"
                  description="Right-click an item or use the command menu and choose Snooze notifications."
                />
              }
            >
              <For each={snoozedEntities()}>
                {(item) => (
                  <MutedItemRow
                    item={item}
                    onUnmute={() => void unmuteEntity(item)}
                    onSnooze={() =>
                      openSnoozeNotifications([item], { owner: dialogOwner })
                    }
                    pending={unmuteItem.isPending}
                  />
                )}
              </For>
            </Show>
          </Show>
          <SettingsRow
            label="Snooze an item"
            description="Pause notifications for a channel, document, email, or other item."
          >
            <button
              type="button"
              class="text-sm text-ink-muted hover:text-ink mobile:min-h-11"
              onClick={() => openSnoozeEntityPicker({ owner: dialogOwner })}
            >
              Choose item…
            </button>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title="Muted items"
        description="These items will not send you notifications."
      >
        <SettingsCard>
          <Show
            when={permanentlyMutedEntities().length > 0}
            fallback={
              <SettingsRow
                label="Nothing muted"
                description="Items you mute stop sending notifications."
              />
            }
          >
            <For each={permanentlyMutedEntities()}>
              {(item) => (
                <MutedItemRow
                  item={item}
                  onUnmute={() => void unmuteEntity(item)}
                  onSnooze={() =>
                    openSnoozeNotifications([item], { owner: dialogOwner })
                  }
                  pending={unmuteItem.isPending}
                />
              )}
            </For>
          </Show>
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  );
}
