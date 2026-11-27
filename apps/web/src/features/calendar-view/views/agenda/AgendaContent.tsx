import { useCalendarNavigation } from '@app/features/calendar/context/calendar-navigation-context';
import { t } from '@app/lib/i18n';
import { useUserId } from '@core/context/user';
import { startOfDay } from 'date-fns';
import { createMemo, Show } from 'solid-js';
import { AgendaWindowList } from './AgendaWindowList';

/** A new account or requested date starts a fresh list session. */
export function AgendaContent() {
  const navigation = useCalendarNavigation();
  const account = useUserId();
  const date = createMemo(() =>
    startOfDay(navigation.navigationDate() ?? new Date())
  );
  // Preserve navigation requests, including Today when the day is unchanged.
  const session = createMemo(() =>
    account() ? { account: account(), date: date() } : undefined
  );

  return (
    <Show
      when={session()}
      keyed
      fallback={<p class="p-5">{t('calendar.agendaSignIn')}</p>}
    >
      {(session) => <AgendaWindowList date={session.date} />}
    </Show>
  );
}
