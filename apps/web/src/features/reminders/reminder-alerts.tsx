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
import { showReminderAlert } from './views/reminder-alert-toast';

/** App composition: delivered occurrences, browser focus, and native Macro toasts. */
export function useReminderAlerts(source: AlertNotificationSource): void {
  const userId = useUserId();
  const isAuthenticated = useIsAuthenticated();
  const account = () => (isAuthenticated() ? userId() : undefined);
  const remindersFlag = useFeatureFlag(enableReminders);
  const dismissals = createReminderAlertDismissals(account);

  createReminderAlerts({
    items: createReminderAlertFeed(source, account),
    active: () => !!account() && remindersFlag().enabled && isTabFocused(),
    acknowledgedKeys: dismissals.keys,
    acknowledge: dismissals.acknowledge,
    show: (items, acknowledge) =>
      showReminderAlert(items, acknowledge, (reminderId) => {
        const manager = globalSplitManager();
        if (!manager) return false;
        manager.openWithSplit({
          type: 'component',
          id: reminderId ? `reminder-view~${reminderId}` : 'reminders',
        });
        return true;
      }),
  });
}
