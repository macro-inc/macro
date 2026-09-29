import { defineRoute, useRouteParams } from '@app/lib/split-router';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import {
  RedirectSplit,
  usePageViewTracking,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { enableReminders, isFeatureEnabled } from '@core/constant/featureFlags';
import { lazy, onMount } from 'solid-js';
import { z } from 'zod';
import { getViewPreset } from '../next-soup/sidebar/soup-filter-presets';
import { ReminderDetails } from './ReminderEditorSplit';
import { REMINDER_DETAIL_ROUTE_ID } from './reminder-navigation';

const SoupView = lazy(async () => ({
  default: (await import('../next-soup/soup-view/soup-view')).SoupView,
}));

export const RemindersRouteView = withAuth(() => {
  if (!isFeatureEnabled(enableReminders))
    return <RedirectSplit to={{ type: 'component', id: 'home' }} />;
  usePageViewTracking('reminders');
  const preset = getViewPreset('reminders');
  return (
    <SoupView
      viewName="Reminders"
      initialFilters={preset?.filters}
      initialClientFilters={preset?.clientFilters}
      initialGroupBy={preset?.groupBy}
      disableLocalSearch
    />
  );
});

export const remindersRoute = defineRoute({
  id: 'view-reminders',
  path: 'reminders',
  component: RemindersRouteView,
  search: '*' as const,
  claim: () => ({ namespace: 'component', id: 'reminders' }),
});

const ReminderDetailRouteView = withAuth(() => {
  const params = useRouteParams(reminderDetailRoute);
  const panel = useSplitPanelOrThrow();
  if (!isFeatureEnabled(enableReminders)) {
    return <RedirectSplit to={{ type: 'component', id: 'home' }} />;
  }
  usePageViewTracking('reminder');
  onMount(() => panel.handle.setDisplayName('Reminder'));
  return (
    <ReminderDetails
      reminderId={params.reminderId}
      onClose={() => panel.handle.close()}
    />
  );
});

/** Lightweight standalone reminder detail at `/app/reminder/:reminderId`. */
export const reminderDetailRoute = defineRoute({
  id: REMINDER_DETAIL_ROUTE_ID,
  path: 'reminder/:reminderId',
  params: z.object({ reminderId: z.string().min(1) }),
  component: ReminderDetailRouteView,
  remountKey: ({ reminderId }) => reminderId,
  claim: ({ reminderId }) => ({ namespace: 'reminder', id: reminderId }),
});
