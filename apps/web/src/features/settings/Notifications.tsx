import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { toast } from '@core/component/Toast/Toast';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import {
  EMAIL_DIGEST_NOTIFICATION_TYPE,
  mutedEntityTypeLabel,
  NOTIFICATION_EVENT_GROUPS,
} from '@notifications/notification-event-catalog';
import { useNotificationSettings } from '@notifications/notification-settings';
import { createMutedEntitiesQuery } from '@notifications/queries/muted-entities-query';
import {
  createNotificationTypePreferencesQuery,
  createSetNotificationTypeEnabledMutation,
} from '@notifications/queries/type-preferences-query';
import { notificationServiceClient } from '@service-notification/client';
import { ToggleSwitch } from '@ui';
import { For, Show } from 'solid-js';
import {
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from './primitives';

export function Notifications() {
  const analytics = useAnalytics();
  const platformSettings = useNotificationSettings();
  const preferencesQuery = createNotificationTypePreferencesQuery();
  const setTypeEnabled = createSetNotificationTypeEnabledMutation();
  const mutedEntitiesQuery = createMutedEntitiesQuery({ limit: 100 });

  const disabledTypes = () =>
    new Set(preferencesQuery.data?.disabled_types ?? []);

  const isTypeEnabled = (type: string) => !disabledTypes().has(type);

  const toggleType = async (type: string, enabled: boolean) => {
    try {
      await setTypeEnabled.mutateAsync({ type, enabled });
    } catch {
      toast.failure('Could not update notification preference');
    }
  };

  const unmuteEntity = async (item: { item_id: string; item_type: string }) => {
    const result = await notificationServiceClient.removeUnsubscribeItem(item);
    if (result.isErr()) {
      toast.failure('Could not unmute item');
      return;
    }
    await mutedEntitiesQuery.refetch();
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
              disabled={preferencesQuery.isLoading}
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
                      disabled={preferencesQuery.isLoading}
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
        title="Muted items"
        description="These items will not send you notifications."
      >
        <SettingsCard>
          <Show
            when={(mutedEntitiesQuery.data ?? []).length > 0}
            fallback={
              <SettingsRow
                label="Nothing muted"
                description="Items you mute stop sending notifications."
              />
            }
          >
            <For each={mutedEntitiesQuery.data ?? []}>
              {(item) => (
                <SettingsRow
                  label={mutedEntityTypeLabel(item.item_type)}
                  description={item.item_id}
                >
                  <button
                    type="button"
                    class="text-sm text-ink-muted hover:text-ink"
                    onClick={() => unmuteEntity(item)}
                  >
                    Unmute
                  </button>
                </SettingsRow>
              )}
            </For>
          </Show>
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  );
}
