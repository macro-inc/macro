import {
  RedirectSplit,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';

export const RemindersRouteView = withAuth(() => (
  <RedirectSplit
    to={{
      type: 'component',
      id: 'mail',
      entryMetadata: { search: { tab: 'reminders' } },
    }}
  />
));

export const ReminderDetailRouteView = RemindersRouteView;
