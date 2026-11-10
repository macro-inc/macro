import { NotificationSoundSettingsView } from '@app/features/notification-sounds/views/NotificationSoundSettingsView';
import { NotificationStacksSection } from '@app/features/notification-stacks/notification-stacks';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { inEnglish, t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import {
  enableMacroComputers,
  enableNotificationStacks,
} from '@core/constant/featureFlags';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  EMAIL_DIGEST_NOTIFICATION_TYPE,
  NOTIFICATION_EVENT_GROUPS,
} from '@notifications/notification-event-catalog';
import { useNotificationSettings } from '@notifications/notification-settings';
import { notificationsBlockedMessage } from '@notifications/notifications-blocked-message';
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
import { createSignal, For, getOwner, Show } from 'solid-js';
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
  const macroComputers = useFeatureFlag(enableMacroComputers);
  const platformSettings = useNotificationSettings();
  const [pushPending, setPushPending] = createSignal(false);
  const preferencesQuery = useNotificationTypePreferencesQuery();
  const setTypeEnabled = useSetNotificationTypeEnabledMutation();
  const mutedEntitiesQuery = useMutedEntitiesQuery({ limit: 100 });
  const unmuteItem = useUnmuteItemMutation();
  const stacks = useFeatureFlag(enableNotificationStacks);
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

  const togglePush = async (enabled: boolean) => {
    if (!platformSettings.isSupported || pushPending()) return;
    setPushPending(true);
    try {
      analytics.track('notifications_toggled');
      await platformSettings.toggle(enabled);
      if (enabled && !platformSettings.isEnabled()) {
        toast.failure(notificationsBlockedMessage());
      }
    } catch (error) {
      console.error('Could not update notification permission', error);
      toast.failure(t('settingsNotifications.pushUpdateFailed'));
    } finally {
      setPushPending(false);
    }
  };

  const toggleType = async (type: string, enabled: boolean) => {
    try {
      await setTypeEnabled.mutateAsync({ type, enabled });
    } catch {
      toast.failure(t('settingsNotifications.preferenceUpdateFailed'));
    }
  };

  const unmuteEntity = async (item: { item_id: string; item_type: string }) => {
    try {
      await unmuteItem.mutateAsync(item);
    } catch {
      toast.failure(t('settingsNotifications.unmuteFailed'));
    }
  };

  const pushLabel = () =>
    isNativeMobilePlatform()
      ? t('settingsNotifications.mobilePush')
      : t('settingsNotifications.desktopPush');
  const pushDescription = () =>
    isNativeMobilePlatform()
      ? t('settingsNotifications.mobilePushDescription')
      : t('settingsNotifications.desktopPushDescription');

  return (
    <SettingsPage
      title={t('settingsNotifications.title')}
      description={t('settingsNotifications.description')}
    >
      {/* Section targets stay English: settings search points at them. */}
      <SettingsSection
        title={t('settingsNotifications.delivery')}
        target="Delivery"
      >
        <SettingsCard>
          <SettingsRow
            label={t('settingsNotifications.inbox')}
            description={t('settingsNotifications.inboxDescription')}
          >
            <span class="text-sm text-ink-muted">
              {t('settingsNotifications.alwaysOn')}
            </span>
          </SettingsRow>
          <Show
            when={platformSettings.isSupported && platformSettings}
            fallback={
              <SettingsRow label={pushLabel()} description={pushDescription()}>
                <span class="text-sm text-ink-muted">
                  {t('settingsNotifications.pushUnsupported')}
                </span>
              </SettingsRow>
            }
          >
            {(settings) => (
              <SettingsRow label={pushLabel()} description={pushDescription()}>
                <ToggleSwitch
                  size="md"
                  label={pushLabel()}
                  labelClass="sr-only"
                  checked={settings().isEnabled()}
                  disabled={pushPending()}
                  onChange={(enabled) =>
                    fireAndForget(togglePush(enabled), 'notification-settings')
                  }
                />
              </SettingsRow>
            )}
          </Show>
          <SettingsRow
            label={t('settingsNotifications.emailDigest')}
            target="Email digest"
            description={t('settingsNotifications.emailDigestDescription')}
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

      <NotificationSoundSettingsView />

      <For each={NOTIFICATION_EVENT_GROUPS}>
        {(group) => (
          <SettingsSection
            title={group.label}
            target={inEnglish(() => group.label)}
          >
            <SettingsCard>
              <For
                each={group.events.filter(
                  (event) => !event.macroComputers || macroComputers().enabled
                )}
              >
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

      <Show when={stacks().enabled}>
        <NotificationStacksSection />
      </Show>

      <SettingsSection
        title={t('settingsNotifications.snoozedTitle')}
        target="Snoozed items"
        description={t('settingsNotifications.snoozedDescription')}
      >
        <SettingsCard>
          <Show when={mutedEntitiesQuery.isError}>
            <SettingsRow label={t('settingsNotifications.snoozedLoadFailed')}>
              <button
                type="button"
                onClick={() =>
                  fireAndForget(
                    mutedEntitiesQuery.refetch(),
                    'notification-settings'
                  )
                }
              >
                {t('settingsNotifications.retry')}
              </button>
            </SettingsRow>
          </Show>
          <Show
            when={
              !mutedEntitiesQuery.isError && queryReadyGate(mutedEntitiesQuery)
            }
            fallback={
              !mutedEntitiesQuery.isError && (
                <SettingsRow
                  label={t('settingsNotifications.snoozedLoading')}
                />
              )
            }
          >
            <Show
              when={snoozedEntities().length > 0}
              fallback={
                <SettingsRow
                  label={t('settingsNotifications.snoozedEmpty')}
                  description={t(
                    'settingsNotifications.snoozedEmptyDescription'
                  )}
                />
              }
            >
              <For each={snoozedEntities()}>
                {(item) => (
                  <MutedItemRow
                    item={item}
                    onUnmute={() =>
                      fireAndForget(unmuteEntity(item), 'notification-settings')
                    }
                    onSnooze={() =>
                      openSnoozeNotifications([item], { owner: dialogOwner })
                    }
                    pending={unmuteItem.isPending}
                  />
                )}
              </For>
            </Show>
          </Show>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title={t('settingsNotifications.mutedTitle')}
        target="Muted items"
        description={t('settingsNotifications.mutedDescription')}
      >
        <SettingsCard>
          <Show
            when={permanentlyMutedEntities().length > 0}
            fallback={
              <SettingsRow
                label={t('settingsNotifications.mutedEmpty')}
                description={t('settingsNotifications.mutedEmptyDescription')}
              />
            }
          >
            <For each={permanentlyMutedEntities()}>
              {(item) => (
                <MutedItemRow
                  item={item}
                  onUnmute={() =>
                    fireAndForget(unmuteEntity(item), 'notification-settings')
                  }
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
