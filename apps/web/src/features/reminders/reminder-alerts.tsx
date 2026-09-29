import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { globalSplitManager } from '@app/signal/splitLayout';
import { enableReminders } from '@core/constant/featureFlags';
import { useIsAuthenticated, useUserId } from '@core/context/user';
import { isTabFocused } from '@core/signal/tabFocus';
import { createReminderAlerts } from './primitives/create-reminder-alerts';
import {
  type AlertNotificationSource,
  createReminderAlertFeed,
} from './queries/create-reminder-alert-feed';
import { createReminderAlertDismissals } from './reminder-alert-dismissals';
import { openReminderDetail } from './reminder-navigation';
import { showReminderAlert } from './views/reminder-alert-toast';

/** App composition: delivered occurrences, browser focus, and native Macro toasts. */
export function useReminderAlerts(
  source: Omit<AlertNotificationSource, 'isStarted'> & {
    readonly _notificationsQuery: { readonly isStarted: boolean };
  }
): void {
  const userId = useUserId();
  const isAuthenticated = useIsAuthenticated();
  const remindersFlag = useFeatureFlag(enableReminders);
  const account = () =>
    isAuthenticated() && remindersFlag().enabled ? userId() : undefined;
  const dismissals = createReminderAlertDismissals(account);

  createReminderAlerts({
    items: createReminderAlertFeed(
      {
        notifications: source.notifications,
        isLoading: source.isLoading,
        isStarted: () => source._notificationsQuery.isStarted,
        mutedEntities: source.mutedEntities,
        subscribe: source.subscribe,
        withLocalOverrides: (notification) =>
          source.withLocalOverrides?.(notification) ?? notification,
      },
      account
    ),
    active: () => !!account() && isTabFocused(),
    acknowledgedKeys: dismissals.keys,
    acknowledge: dismissals.acknowledge,
    show: (items, acknowledge) =>
      showReminderAlert(items, acknowledge, (reminderId) => {
        const manager = globalSplitManager();
        if (!manager) return false;
        if (reminderId) openReminderDetail(reminderId, { manager });
        else manager.openWithSplit({ type: 'component', id: 'reminders' });
        return true;
      }),
  });
}
