import { defineRoute } from '@app/lib/split-router';
import {
  RedirectSplit,
  usePageViewTracking,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { enableReminders, isFeatureEnabled } from '@core/constant/featureFlags';
import { lazy } from 'solid-js';
import { getViewPreset } from '../next-soup/sidebar/soup-filter-presets';

const SoupView = lazy(async () => ({
  default: (await import('../next-soup/soup-view/soup-view')).SoupView,
}));

export const RemindersRouteView = withAuth(() => {
  if (!isFeatureEnabled(enableReminders))
    return <RedirectSplit to={{ type: 'component', id: 'inbox' }} />;
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
