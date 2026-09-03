import { useUserId } from '@core/context/user';
import { getDisplayName, tryMacroId } from '@core/user';
import {
  type CalendarOccurrenceQueryRange,
  createCalendarOccurrenceQueryRange,
} from '@queries/calendar/occurrences';
import { useTeamOutOfOfficeQuery } from '@queries/calendar/team-ooo';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { EventType } from '@service-storage/generated/schemas/eventType';
import type { TeamOutOfOfficeItem } from '@service-storage/generated/schemas/teamOutOfOfficeItem';
import { parseISO } from 'date-fns';
import { type Accessor, createMemo } from 'solid-js';
import type { CalendarEvent } from '../types';
import { isCalendarRangeSupported } from '../utils/calendar-supported-range';

/** Visibility-source id gating the whole team out-of-office overlay. */
export const TEAM_OOO_SOURCE_ID = 'team-ooo';

/** Prefix of every per-teammate visibility-source id. */
export const TEAM_OOO_SOURCE_PREFIX = 'team-ooo:';

const TEAM_OOO_COLOR = 'var(--color-ink-muted)';
const TEAM_OOO_FALLBACK_TITLE = 'Out of office';

/** Visibility-source id for one teammate's out-of-office overlay. */
export function teamOooSourceId(ownerId: string) {
  return `${TEAM_OOO_SOURCE_PREFIX}${ownerId}`;
}

/** Whether the current user's team has other members. */
export function useHasTeammates(): Accessor<boolean> {
  const userId = useUserId();
  const teamQuery = useCurrentTeamQuery();

  return () => {
    const team = teamQuery.isSuccess ? teamQuery.data : undefined;
    const self = userId();
    return (team?.members ?? []).some((member) => member.user_id !== self);
  };
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
  const isOverlayVisible = () =>
    options.isSourceVisible?.(TEAM_OOO_SOURCE_ID) !== false;
  const query = useTeamOutOfOfficeQuery(
    () => ({ userId: userId(), range: options.range() }),
    () => ({
      enabled: isRangeSupported() && isOverlayVisible(),
      refetchOnWindowFocus: options.refetchOnWindowFocus?.(),
    })
  );
  const events = createMemo(() => {
    // Read data only on success: a failed overlay fetch degrades to no events
    // since the grid's own state is driven by the occurrences query, and gating
    // on success keeps this off the pending/errored resource read that suspends.
    if (!isRangeSupported() || !query.isSuccess) return [];
    return query.data.map(mapTeamOooItem);
  });
  const visibleEvents = createMemo(() => (isOverlayVisible() ? events() : []));
  const eventsById = createMemo(
    () => new Map(events().map((event) => [event.id, event]))
  );

  return { events, visibleEvents, eventsById };
}

/** One teammate absence window for list surfaces. */
export interface TeamOooWindow {
  ownerId: string;
  eventId: string;
  occurrenceKey: string;
  /** Teammate display name, resolved reactively from the shared cache. */
  name: string;
  /** Event title, absent when visibility withholds it. */
  title?: string;
  start: Date;
  /** Exclusive end. */
  end: Date;
  allDay: boolean;
}

const UPCOMING_TEAM_OOO_DAYS = 90;

/** Upcoming team out-of-office windows with the request's load/error status. */
export interface UpcomingTeamOoo {
  windows: Accessor<TeamOooWindow[]>;
  /** No settled result yet, distinguishing first load from an empty result. */
  isPending: Accessor<boolean>;
  /** The request failed, distinguishing an error from an empty result. */
  isError: Accessor<boolean>;
}

/** Teammates' out-of-office windows from today forward, soonest first. */
export function useUpcomingTeamOoo(): UpcomingTeamOoo {
  const userId = useUserId();
  const rangeStart = new Date();
  rangeStart.setHours(0, 0, 0, 0);
  const rangeEnd = new Date(rangeStart);
  rangeEnd.setDate(rangeEnd.getDate() + UPCOMING_TEAM_OOO_DAYS);
  const range = createCalendarOccurrenceQueryRange(rangeStart, rangeEnd);
  const query = useTeamOutOfOfficeQuery(() => ({ userId: userId(), range }));

  const windows = createMemo<TeamOooWindow[]>(() => {
    // Read data only on success so a pending query never hits the suspending
    // resource read and an errored refetch never surfaces stale rows.
    if (!query.isSuccess) return [];
    return query.data.map((item) => {
      const time = item.time;
      const [start, end, allDay] =
        time.kind === 'timed'
          ? [new Date(time.startsAt), new Date(time.endsAt), false]
          : [parseISO(time.startDate), parseISO(time.endDate), true];
      return {
        ownerId: item.ownerId,
        eventId: item.eventId,
        occurrenceKey: item.occurrenceKey,
        name: getDisplayName(tryMacroId(item.ownerId)),
        title: item.title ?? undefined,
        start,
        end,
        allDay,
      };
    });
  });

  return {
    windows,
    isPending: () => query.isPending,
    isError: () => query.isError,
  };
}
