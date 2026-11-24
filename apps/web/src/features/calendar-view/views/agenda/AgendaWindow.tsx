import { AgendaDayHeader } from '@app/features/calendar/components/agenda/AgendaDayHeader';
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
import { TraceFlow, usePending } from '@app/observability/flow';
import { createCalendarOccurrenceQueryRange } from '@queries/calendar/occurrences';
import { Key } from '@solid-primitives/keyed';
import { addDays, eachDayOfInterval } from 'date-fns';
import { createMemo, For, Match, onCleanup, Show, Switch } from 'solid-js';
import type { AgendaGrouping } from '../../primitives/create-agenda-grouping';
import { AgendaOccurrence } from './AgendaOccurrence';

/** One bounded source window; stable day containers keep late data from resetting the list. */
export function AgendaWindow(props: {
  anchor: Date;
  index: number;
  active: boolean;
  grouping: AgendaGrouping;
}) {
  return (
    <TraceFlow name="calendar.agenda.window">
      <AgendaWindowBody {...props} />
    </TraceFlow>
  );
}

function AgendaWindowBody(props: {
  anchor: Date;
  index: number;
  active: boolean;
  grouping: AgendaGrouping;
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
  const days = createMemo(() =>
    eachDayOfInterval({ start: window().start, end: addDays(window().end, -1) })
  );
  const grouped = createMemo(() =>
    groupAgendaDays(
      agendaEventsByDay(visibleEvents(), window().start),
      new Date(),
      (previous, next) =>
        (previous >= supported.start && previous < supported.end) ===
        (next >= supported.start && next < supported.end)
    )
  );
  const grouping = props.grouping;
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
              .find((item) => item.start.getTime() === day.getTime());
          const supportedDay = day >= supported.start && day < supported.end;
          return (
            <section
              data-agenda-day={day.getTime()}
              data-agenda-group-end={group()?.end.getTime()}
            >
              <Show when={group()}>
                {(entry) => (
                  <div class="mb-6">
                    <AgendaDayHeader date={entry().start} end={entry().end} />
                    <Switch
                      fallback={
                        <div class="flex max-w-2xl gap-3 px-5">
                          <span class="w-16 shrink-0" aria-hidden="true" />
                          <p class="flex min-h-12 items-center px-1 text-xs text-ink-extra-muted">
                            {t('calendar.agendaNoEvents')}
                          </p>
                        </div>
                      }
                    >
                      <Match when={!supportedDay}>
                        <p class="min-h-12 px-5 py-3 text-sm text-ink-muted">
                          {t('calendar.agendaOutOfRange')}
                        </p>
                      </Match>
                      <Match
                        when={
                          data.isLoading() ||
                          (team.isPending() &&
                            !entry().events.length &&
                            !failed())
                        }
                      >
                        <p
                          role="status"
                          class="min-h-12 px-5 py-3 text-sm text-ink-muted"
                        >
                          {t('calendar.agendaLoading')}
                        </p>
                      </Match>
                      <Match when={entry().events.length > 0 || failed()}>
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
