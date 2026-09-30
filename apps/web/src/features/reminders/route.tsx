import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { defineRoute, useRouteParams } from '@app/lib/split-router';
import type { SplitContent } from '@components/app/split-layout/layoutManager';
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
import { Show } from 'solid-js';
import { z } from 'zod';
import { emailTabSearch, emailTabSearchCodec } from '../email-view/email-route';
import { ReminderDetails } from './ReminderEditorSplit';
import { REMINDER_DETAIL_ROUTE_ID } from './reminder-navigation';

/**
 * Reminders live under Email as a tab rather than in a view of their own.
 * `/reminders` stays routable for existing links and notifications and lands
 * on that tab; `RedirectSplit` carries the tab through the split's search.
 */
const remindersTabContent: SplitContent = {
  type: 'component',
  id: 'mail',
  entryMetadata: {
    search: {
      [emailTabSearch.namespace]: emailTabSearchCodec.serialize({
        tab: 'reminders',
      }),
    },
  },
};

export const RemindersRouteView = withAuth(() => {
  const reminders = useFeatureFlag(enableReminders);
  return (
    <Show when={!reminders().loading} fallback={<LoadingBlock />}>
      <Show
        when={reminders().enabled}
        fallback={<RedirectSplit to={{ type: 'component', id: 'home' }} />}
      >
        <RedirectSplit to={remindersTabContent} />
      </Show>
    </Show>
  );
});

export const remindersRoute = defineRoute({
  id: 'view-reminders',
  path: 'reminders',
  component: RemindersRouteView,
  search: '*' as const,
  claim: () => ({ namespace: 'component', id: 'reminders' }),
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

const ReminderDetailRouteView = withAuth(() => {
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

/** Lightweight standalone reminder detail at `/app/reminder/:reminderId`. */
export const reminderDetailRoute = defineRoute({
  id: REMINDER_DETAIL_ROUTE_ID,
  path: 'reminder/:reminderId',
  params: z.object({ reminderId: z.string().min(1) }),
  component: ReminderDetailRouteView,
  remountKey: ({ reminderId }) => reminderId,
  claim: ({ reminderId }) => ({ namespace: 'reminder', id: reminderId }),
});
