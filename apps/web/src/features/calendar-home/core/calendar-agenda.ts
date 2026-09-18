import { format, parseISO } from 'date-fns';

export interface CalendarAgendaEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  color: string;
  calendar: string;
  hasCall: boolean;
}

export function groupAgendaEvents(
  events: readonly CalendarAgendaEvent[],
  rangeStart?: Date
) {
  const groups = new Map<string, CalendarAgendaEvent[]>();
  for (const event of [...events].sort(
    (a, b) => parseISO(a.start).getTime() - parseISO(b.start).getTime()
  )) {
    const start = parseISO(event.start);
    const day = format(
      rangeStart && start < rangeStart ? rangeStart : start,
      'yyyy-MM-dd'
    );
    const group = groups.get(day);
    if (group) group.push(event);
    else groups.set(day, [event]);
  }
  return [...groups].map(([day, events]) => ({ day, events }));
}
