import { useUserId } from '@core/context/user';
import { getDisplayName, tryMacroId } from '@core/user';
import type { CalendarOccurrenceQueryRange } from '@queries/calendar/occurrences';
import { useTeamOutOfOfficeQuery } from '@queries/calendar/team-ooo';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { EventType } from '@service-storage/generated/schemas/eventType';
import type { TeamOutOfOfficeItem } from '@service-storage/generated/schemas/teamOutOfOfficeItem';
import { type Accessor, createMemo } from 'solid-js';
import type { CalendarEvent, CalendarSource } from '../types';
import { isCalendarRangeSupported } from '../utils/calendar-supported-range';

const TEAM_OOO_SOURCE_PREFIX = 'team-ooo:';
const TEAM_OOO_COLOR = 'var(--color-ink-muted)';
const TEAM_OOO_FALLBACK_TITLE = 'Out of office';

/** Visibility-source id for one teammate's out-of-office overlay. */
export function teamOooSourceId(ownerId: string) {
  return `${TEAM_OOO_SOURCE_PREFIX}${ownerId}`;
}

/** Per-teammate visibility sources for the team out-of-office overlay. */
export function useTeamOooSources(): Accessor<CalendarSource[]> {
  const userId = useUserId();
  const teamQuery = useCurrentTeamQuery();

  return createMemo(() => {
    const team = teamQuery.isSuccess ? teamQuery.data : undefined;
    const self = userId();
    if (!team) return [];

    return team.members
      .filter((member) => member.user_id !== self)
      .map((member) => ({
        id: teamOooSourceId(member.user_id),
        name: getDisplayName(tryMacroId(member.user_id)),
        color: TEAM_OOO_COLOR,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });
}

function mapTeamOooItem(item: TeamOutOfOfficeItem): CalendarEvent {
  const time = item.time;
  const range =
    time.kind === 'timed'
      ? { allDay: false, start: time.startsAt, end: time.endsAt }
      : { allDay: true, start: time.startDate, end: time.endDate };
  const name = getDisplayName(tryMacroId(item.ownerId));
  const title = item.title ?? TEAM_OOO_FALLBACK_TITLE;

  return {
    ...range,
    id: JSON.stringify([item.eventId, item.occurrenceKey]),
    eventId: item.eventId,
    occurrenceKey: item.occurrenceKey,
    isCancelled: false,
    isReadOnly: true,
    attendees: [],
    recurrenceLines: [],
    eventType: EventType.out_of_office,
    timeZone: time.kind === 'timed' ? (time.timeZone ?? undefined) : undefined,
    title: name ? `${name}: ${title}` : title,
    calendar: {
      id: teamOooSourceId(item.ownerId),
      name: name || TEAM_OOO_FALLBACK_TITLE,
      color: TEAM_OOO_COLOR,
    },
  };
}

export interface TeamOooEventData {
  events: Accessor<CalendarEvent[]>;
  visibleEvents: Accessor<CalendarEvent[]>;
  eventsById: Accessor<Map<string, CalendarEvent>>;
}

export interface TeamOooEventOptions {
  range: Accessor<CalendarOccurrenceQueryRange | undefined>;
  isSourceVisible?: (sourceId: string) => boolean;
  refetchOnWindowFocus?: Accessor<boolean>;
}

/** Query-backed teammate out-of-office events overlaid on the calendar. */
export function useTeamOooEvents(
  options: TeamOooEventOptions
): TeamOooEventData {
  const userId = useUserId();
  const isRangeSupported = createMemo(() => {
    const range = options.range();
    return range !== undefined && isCalendarRangeSupported(range);
  });
  const query = useTeamOutOfOfficeQuery(
    () => ({ userId: userId(), range: options.range() }),
    () => ({
      enabled: isRangeSupported(),
      refetchOnWindowFocus: options.refetchOnWindowFocus?.(),
    })
  );
  const events = createMemo(() => {
    if (!isRangeSupported()) return [];
    return (query.data ?? []).map(mapTeamOooItem);
  });
  const visibleEvents = createMemo(() =>
    events().filter(
      (event) => options.isSourceVisible?.(event.calendar.id) !== false
    )
  );
  const eventsById = createMemo(
    () => new Map(events().map((event) => [event.id, event]))
  );

  return { events, visibleEvents, eventsById };
}
