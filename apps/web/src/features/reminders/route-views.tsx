import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useRouteParams } from '@app/lib/split-router';
import { reminderDetailRoute } from '@app/routes/routes';
import {
  useSplitDisplayName,
  useSplitPanelOrThrow,
} from '@components/app/split-layout/layoutUtils';
import {
  RedirectSplit,
  usePageViewTracking,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { enableReminders } from '@core/constant/featureFlags';
import { lazy, Show } from 'solid-js';
import { getViewPreset } from '../next-soup/sidebar/soup-filter-presets';
import { ReminderDetails } from './ReminderEditorSplit';

const SoupView = lazy(async () => ({
  default: (await import('../next-soup/soup-view/soup-view')).SoupView,
}));

function RemindersView() {
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
}

export const RemindersRouteView = withAuth(() => {
  const reminders = useFeatureFlag(enableReminders);
  return (
    <Show when={!reminders().loading} fallback={<LoadingBlock />}>
      <Show
        when={reminders().enabled}
        fallback={<RedirectSplit to={{ type: 'component', id: 'home' }} />}
      >
        <RemindersView />
      </Show>
    </Show>
  );
});

function ReminderDetailView() {
  const params = useRouteParams(reminderDetailRoute);
  const panel = useSplitPanelOrThrow();
  usePageViewTracking('reminder');
  useSplitDisplayName(() => 'Reminder');
  return (
    <ReminderDetails
      reminderId={params.reminderId}
      onClose={() => panel.handle.close()}
    />
  );
}

export const ReminderDetailRouteView = withAuth(() => {
  const reminders = useFeatureFlag(enableReminders);
  return (
    <Show when={!reminders().loading} fallback={<LoadingBlock />}>
      <Show
        when={reminders().enabled}
        fallback={<RedirectSplit to={{ type: 'component', id: 'home' }} />}
      >
        <ReminderDetailView />
      </Show>
    </Show>
  );
});
