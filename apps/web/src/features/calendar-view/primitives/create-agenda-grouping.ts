import type { AgendaDayGroup } from '@app/features/calendar/primitives/agenda-window';
import type { CalendarEvent } from '@app/features/calendar/types';
import { addDays, startOfDay } from 'date-fns';
import { type Accessor, createMemo } from 'solid-js';
import { createStore } from 'solid-js/store';

export interface AgendaWindowGroups {
  groups: AgendaDayGroup<CalendarEvent>[];
  complete: boolean;
}
type WindowSource = Accessor<AgendaWindowGroups>;

/** Merge only confirmed empty boundaries; query ownership stays with each bounded window. */
function mergeAgendaWindowGroups(
  windows: { index: number; value: AgendaWindowGroups }[],
  today = new Date()
) {
  const output: { index: number; groups: AgendaDayGroup<CalendarEvent>[] }[] =
    windows.map((window) => ({ index: window.index, groups: [] }));
  let previous:
    | { group: AgendaDayGroup<CalendarEvent>; complete: boolean }
    | undefined;
  const todayTime = startOfDay(today).getTime();
  windows.forEach((window, index) => {
    for (const group of window.value.groups) {
      const emptyBoundary =
        previous &&
        previous.complete &&
        window.value.complete &&
        previous.group.events.length === 0 &&
        group.events.length === 0;
      const adjacent =
        previous &&
        addDays(previous.group.end, 1).getTime() === group.start.getTime();
      const includesToday =
        (group.start <= today && group.end >= startOfDay(today)) ||
        previous?.group.end.getTime() === todayTime;
      if (previous && emptyBoundary && adjacent && !includesToday)
        previous.group.end = group.end;
      else {
        const copy = { ...group };
        output[index].groups.push(copy);
        previous = { group: copy, complete: window.value.complete };
      }
    }
  });
  return output;
}

export function createAgendaGrouping() {
  const [sources, setSources] = createStore<
    Record<number, WindowSource | undefined>
  >({});
  const grouped = createMemo(() =>
    mergeAgendaWindowGroups(
      Object.entries(sources)
        .flatMap(([index, source]) =>
          source ? [{ index: Number(index), value: source() }] : []
        )
        .sort((a, b) => a.index - b.index)
    )
  );
  return {
    register: (index: number, source: WindowSource) => {
      setSources(index, () => source);
      return () => {
        if (sources[index] === source) setSources(index, undefined);
      };
    },
    groups: (index: number) =>
      grouped().find((window) => window.index === index)?.groups ?? [],
  };
}
export type AgendaGrouping = ReturnType<typeof createAgendaGrouping>;
