import { useCalendarNavigation } from '@app/features/calendar/context/calendar-navigation-context';
import { agendaDay } from '@app/features/calendar/primitives/agenda-window';
import { t } from '@app/lib/i18n';
import { useUserId } from '@core/context/user';
import { createMemo, Show } from 'solid-js';
import { AgendaWindowList } from './AgendaWindowList';

/** A new account or requested date starts a fresh list session. */
export function AgendaContent() {
  const navigation = useCalendarNavigation();
  const account = useUserId();
  const date = createMemo(() =>
    agendaDay(navigation.navigationDate() ?? new Date())
  );
  const session = createMemo(
    () => account() && `${account()}|${date().toDateString()}`
  );

  return (
    <Show
      when={session()}
      keyed
      fallback={<p class="p-5">{t('calendar.agendaSignIn')}</p>}
    >
      {(_session) => <AgendaWindowList date={date()} />}
    </Show>
  );
}
