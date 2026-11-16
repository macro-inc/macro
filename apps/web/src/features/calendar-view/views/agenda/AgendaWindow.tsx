import { AgendaDayHeader } from '@app/features/calendar/components/agenda/day-header/AgendaDayHeader';
import { useCalendarView } from '@app/features/calendar/components/CalendarViewContext';
import { useCalendarOccurrenceData } from '@app/features/calendar/hooks/use-calendar-occurrence-data';
import { useTeamOooEvents } from '@app/features/calendar/hooks/use-team-ooo';
import {
  agendaEventsByDay,
  agendaWindow,
  clipAgendaWindow,
} from '@app/features/calendar/primitives/agenda-window';
import { getCalendarSupportedRange } from '@app/features/calendar/utils/calendar-supported-range';
import { mergeCalendarOverlays } from '@app/features/calendar-team/core/merge';
import { formatLocale, t } from '@app/lib/i18n';
import { usePending } from '@app/observability/flow';
import { createCalendarOccurrenceQueryRange } from '@queries/calendar/occurrences';
import { Key } from '@solid-primitives/keyed';
import { createMemo, For, Match, Show, Switch } from 'solid-js';
import { AgendaOccurrence } from './AgendaOccurrence';

/** One bounded source window; stable day containers keep late data from resetting the list. */
export function AgendaWindow(props: {
  anchor: Date;
  index: number;
  active: boolean;
}) {
  const view = useCalendarView();
  const window = createMemo(() => agendaWindow(props.anchor, props.index));
  const supported = getCalendarSupportedRange();
  const queryWindow = createMemo(() => clipAgendaWindow(window(), supported));
  const range = createMemo(() => {
    const bounded = queryWindow();
    return bounded
      ? createCalendarOccurrenceQueryRange(bounded.start, bounded.end)
      : undefined;
  });
  const data = useCalendarOccurrenceData({
    range,
    sourceById: view.sourceById,
    sourcesReady: view.sourcesReady,
    isSourceVisible: view.isSourceVisible,
    // Neighbors load once; only the visible window polls and refetches on focus.
    queryOptions: () => ({
      pollWhileSyncing: props.active,
      refetchOnWindowFocus: props.active,
    }),
  });
  const team = useTeamOooEvents({
    range,
    isSourceVisible: view.isSourceVisible,
    refetchOnWindowFocus: () => props.active,
  });
  const failed = () => data.occurrencesQuery.isError || team.isError();
  usePending(
    'calendar.agenda.overlay',
    () => queryWindow() !== undefined && team.isPending()
  );
  const visibleEvents = createMemo(() =>
    mergeCalendarOverlays(data.visibleEvents(), team.events())
  );
  usePending(
    'calendar.agenda.window',
    () => queryWindow() !== undefined && data.isLoading()
  );
  const days = createMemo(() => agendaEventsByDay([], window().start));
  const grouped = createMemo(() =>
    agendaEventsByDay(visibleEvents(), window().start)
  );

  return (
    <section
      data-agenda-window={props.index}
      aria-label={t('calendar.agendaStarting', {
        date: window().start.toLocaleDateString(formatLocale()),
      })}
    >
      <For each={days()}>
        {(day, index) => {
          const events = () => grouped()[index()]?.events ?? [];
          const supportedDay =
            day.date >= supported.start && day.date < supported.end;
          return (
            <section data-agenda-day={day.date.toDateString()}>
              <AgendaDayHeader date={day.date} />
              <Switch
                fallback={
                  <p class="min-h-12 px-5 py-3 text-sm text-ink-muted">
                    {t('calendar.agendaNoEvents')}
                  </p>
                }
              >
                <Match when={!supportedDay}>
                  <p class="min-h-12 px-5 py-3 text-sm text-ink-muted">
                    {t('calendar.agendaOutOfRange')}
                  </p>
                </Match>
                <Match when={data.isLoading()}>
                  <p
                    role="status"
                    class="min-h-12 px-5 py-3 text-sm text-ink-muted"
                  >
                    {t('calendar.agendaLoading')}
                  </p>
                </Match>
                <Match when={events().length > 0}>
                  <Key each={events()} by="id">
                    {(event) => <AgendaOccurrence event={event()} />}
                  </Key>
                  <Show when={failed()}>
                    <p role="alert" class="px-5 py-2 text-xs text-failure">
                      {t('calendar.agendaLoadError')}
                    </p>
                  </Show>
                </Match>
                <Match when={failed()}>
                  <p
                    role="alert"
                    class="min-h-12 px-5 py-3 text-sm text-ink-muted"
                  >
                    {t('calendar.agendaLoadError')}
                  </p>
                </Match>
                <Match when={team.isPending()}>
                  <p
                    role="status"
                    class="min-h-12 px-5 py-3 text-sm text-ink-muted"
                  >
                    {t('calendar.agendaLoading')}
                  </p>
                </Match>
              </Switch>
            </section>
          );
        }}
      </For>
    </section>
  );
}
