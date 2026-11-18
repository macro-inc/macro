import { AgendaDayHeader } from '@app/features/calendar/components/agenda/day-header/AgendaDayHeader';
import { useCalendarView } from '@app/features/calendar/components/CalendarViewContext';
import { useCalendarOccurrenceData } from '@app/features/calendar/hooks/use-calendar-occurrence-data';
import { useTeamOooEvents } from '@app/features/calendar/hooks/use-team-ooo';
import {
  agendaEventsByDay,
  agendaWindow,
  clipAgendaWindow,
  groupAgendaDays,
} from '@app/features/calendar/primitives/agenda-window';
import { getCalendarSupportedRange } from '@app/features/calendar/utils/calendar-supported-range';
import { mergeCalendarOverlays } from '@app/features/calendar-team/core/merge';
import { formatLocale, t } from '@app/lib/i18n';
import { usePending } from '@app/observability/flow';
import { createCalendarOccurrenceQueryRange } from '@queries/calendar/occurrences';
import { Key } from '@solid-primitives/keyed';
import { createMemo, For, Match, onCleanup, Show, Switch } from 'solid-js';
import { useAgendaGrouping } from '../../context/agenda-grouping-context';
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
    groupAgendaDays(
      agendaEventsByDay(visibleEvents(), window().start),
      new Date(),
      (previous, next) =>
        (previous >= supported.start && previous < supported.end) ===
        (next >= supported.start && next < supported.end)
    )
  );
  const grouping = useAgendaGrouping();
  onCleanup(
    grouping.register(props.index, () => ({
      groups: grouped(),
      complete:
        !data.isLoading() &&
        !team.isPending() &&
        !failed() &&
        queryWindow()?.start.getTime() === window().start.getTime() &&
        queryWindow()?.end.getTime() === window().end.getTime(),
    }))
  );

  return (
    <section
      data-agenda-window={props.index}
      aria-label={t('calendar.agendaStarting', {
        date: window().start.toLocaleDateString(formatLocale()),
      })}
    >
      <For each={days()}>
        {(day) => {
          const group = () =>
            grouping
              .groups(props.index)
              .find((item) => item.start.getTime() === day.date.getTime());
          const supportedDay =
            day.date >= supported.start && day.date < supported.end;
          return (
            <section
              data-agenda-day={day.date.toDateString()}
              data-agenda-group-end={group()?.end.toDateString()}
            >
              <Show when={group()}>
                {(entry) => (
                  <div class="mb-6">
                    <Show
                      when={entry().start.getTime() !== entry().end.getTime()}
                      fallback={<AgendaDayHeader date={entry().start} />}
                    >
                      <h2 class="sticky top-0 z-10 border-b border-edge bg-surface px-5 py-3 text-sm font-semibold text-ink-muted">
                        {entry().start.toLocaleDateString(formatLocale(), {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        })}{' '}
                        –{' '}
                        {entry().end.toLocaleDateString(formatLocale(), {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </h2>
                    </Show>
                    <Switch
                      fallback={
                        <p class="ml-24 flex min-h-12 items-center px-1 text-xs text-ink-extra-muted">
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
                      <Match when={entry().events.length > 0}>
                        <Key each={entry().events} by="id">
                          {(event) => <AgendaOccurrence event={event()} />}
                        </Key>
                        <Show when={failed()}>
                          <p
                            role="alert"
                            class="px-5 py-2 text-xs text-failure"
                          >
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
                  </div>
                )}
              </Show>
            </section>
          );
        }}
      </For>
    </section>
  );
}
