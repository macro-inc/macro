import { useUserId } from '@core/context/user';
import { getDisplayName, tryMacroId } from '@core/user';
import {
  type CalendarOccurrenceQueryRange,
  createCalendarOccurrenceQueryRange,
} from '@queries/calendar/occurrences';
import {
  type TeamOutOfOfficeQueryOptions,
  useTeamOutOfOfficeQueries,
} from '@queries/calendar/team-ooo';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { EventType } from '@service-storage/generated/schemas/eventType';
import type { TeamOutOfOfficeItem } from '@service-storage/generated/schemas/teamOutOfOfficeItem';
import {
  addDays,
  differenceInCalendarDays,
  max,
  min,
  parseISO,
  startOfDay,
} from 'date-fns';
import { type Accessor, createMemo } from 'solid-js';
import {
  type CalendarEvent,
  DEFAULT_GUEST_POLICY,
  NO_VIEWER_CAPABILITIES,
  TEAM_OOO_SOURCE_ID,
} from '../types';
import {
  getCalendarSupportedRange,
  isCalendarRangeSupported,
} from '../utils/calendar-supported-range';
import { useCalendarTeamOooFlag } from './use-calendar-ui-flag';

/** Prefix of every per-teammate visibility-source id. */
const TEAM_OOO_SOURCE_PREFIX = 'team-ooo:';

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
  const calendar = {
    id: teamOooSourceId(item.ownerId),
    name: name || TEAM_OOO_FALLBACK_TITLE,
    color: TEAM_OOO_COLOR,
  };

  return {
    ...range,
    id: JSON.stringify([item.eventId, item.occurrenceKey]),
    eventId: item.eventId,
    occurrenceKey: item.occurrenceKey,
    teamProjection: {
      ownerId: item.ownerId,
      kind: item.title === undefined ? 'busy' : 'details',
    },
    isCancelled: false,
    isReadOnly: true,
    attendees: [],
    guestPolicy: DEFAULT_GUEST_POLICY,
    viewerCan: NO_VIEWER_CAPABILITIES,
    recurrenceLines: [],
    sourceCalendarIds: [TEAM_OOO_SOURCE_ID],
    eventType: EventType.out_of_office,
    timeZone: time.kind === 'timed' ? (time.timeZone ?? undefined) : undefined,
    title: name ? `${name}: ${title}` : title,
    calendar,
    visibleCalendars: [calendar],
  };
}

/** Days in one shared out-of-office request window. */
const TEAM_OOO_WINDOW_DAYS = 91;
/** A fixed local Monday, so every consumer derives the same windows. */
const TEAM_OOO_WINDOW_EPOCH = new Date(2024, 0, 1);

const windowIndex = (date: Date) =>
  Math.floor(
    differenceInCalendarDays(date, TEAM_OOO_WINDOW_EPOCH) / TEAM_OOO_WINDOW_DAYS
  );

/**
 * The fixed windows covering a viewport, inside the supported range. Every
 * overlay consumer requests whole windows, so the calendar's pages and its
 * sidebar share requests instead of each polling its own range.
 */
export function teamOooWindows(
  range: CalendarOccurrenceQueryRange,
  now = new Date()
): CalendarOccurrenceQueryRange[] {
  const supported = getCalendarSupportedRange(now);
  const lastDay = max([
    addDays(parseISO(range.endDate), -1),
    startOfDay(new Date(Date.parse(range.end) - 1)),
  ]);
  const first = Math.min(
    windowIndex(parseISO(range.startDate)),
    windowIndex(new Date(range.start))
  );
  const windows: CalendarOccurrenceQueryRange[] = [];
  for (let index = first; index <= windowIndex(lastDay); index += 1) {
    const start = max([
      addDays(TEAM_OOO_WINDOW_EPOCH, index * TEAM_OOO_WINDOW_DAYS),
      supported.start,
    ]);
    const end = min([
      addDays(TEAM_OOO_WINDOW_EPOCH, (index + 1) * TEAM_OOO_WINDOW_DAYS),
      supported.end,
    ]);
    if (start < end)
      windows.push(createCalendarOccurrenceQueryRange(start, end));
  }
  return windows;
}

const sameWindows = (
  previous: readonly CalendarOccurrenceQueryRange[],
  next: readonly CalendarOccurrenceQueryRange[]
) =>
  previous.length === next.length &&
  previous.every(
    (window, index) =>
      window.start === next[index]?.start && window.end === next[index]?.end
  );

/** The server's overlap rule, applied to the consumer's own viewport. */
function overlapsRange(
  item: TeamOutOfOfficeItem,
  range: CalendarOccurrenceQueryRange
) {
  const time = item.time;
  return time.kind === 'timed'
    ? Date.parse(time.startsAt) < Date.parse(range.end) &&
        Date.parse(time.endsAt) > Date.parse(range.start)
    : time.startDate < range.endDate && time.endDate > range.startDate;
}

const itemStart = (item: TeamOutOfOfficeItem) =>
  item.time.kind === 'timed'
    ? Date.parse(item.time.startsAt)
    : Date.parse(`${item.time.startDate}T00:00:00Z`);

/** Soonest first, then by event and occurrence, as the server orders them. */
function compareItems(left: TeamOutOfOfficeItem, right: TeamOutOfOfficeItem) {
  return (
    itemStart(left) - itemStart(right) ||
    left.eventId.localeCompare(right.eventId) ||
    left.occurrenceKey.localeCompare(right.occurrenceKey)
  );
}

/**
 * Teammates' out-of-office items in one viewport, read from the shared
 * windows covering it. Items arrive only once every window has settled, as
 * they did from the viewport's own request.
 */
function useTeamOooItems(
  range: Accessor<CalendarOccurrenceQueryRange | undefined>,
  options?: Accessor<TeamOutOfOfficeQueryOptions>
) {
  const userId = useUserId();
  const windows = createMemo(
    () => {
      const current = range();
      return current ? teamOooWindows(current) : [];
    },
    [],
    { equals: sameWindows }
  );
  const queries = useTeamOutOfOfficeQueries(
    () => ({ userId: userId(), ranges: windows() }),
    options
  );
  const items = createMemo<TeamOutOfOfficeItem[]>(() => {
    const current = range();
    // Pending reads suspend, and placeholder data belongs to the previous
    // range. Neither can supply events for the current viewport.
    if (
      !current ||
      queries.length === 0 ||
      !queries.every(
        (query) =>
          query.isSuccess && !query.isPaused && !query.isPlaceholderData
      )
    ) {
      return [];
    }
    const byOccurrence = new Map<string, TeamOutOfOfficeItem>();
    for (const query of queries) {
      if (!query.isSuccess) continue;
      for (const item of query.data) {
        if (overlapsRange(item, current)) {
          byOccurrence.set(
            JSON.stringify([item.eventId, item.occurrenceKey]),
            item
          );
        }
      }
    }
    return [...byOccurrence.values()].sort(compareItems);
  });

  return {
    items,
    isPending: () => queries.some((query) => query.isPending),
    isError: () => queries.some((query) => query.isError || query.isPaused),
  };
}

export interface TeamOooEventData {
  events: Accessor<CalendarEvent[]>;
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
  const teamOooEnabled = useCalendarTeamOooFlag();
  const isRangeSupported = createMemo(() => {
    const range = options.range();
    return range !== undefined && isCalendarRangeSupported(range);
  });
  const isOverlayVisible = () =>
    teamOooEnabled() && options.isSourceVisible?.(TEAM_OOO_SOURCE_ID) !== false;
  const teamOoo = useTeamOooItems(options.range, () => ({
    enabled: isRangeSupported() && isOverlayVisible(),
    refetchOnWindowFocus: options.refetchOnWindowFocus?.(),
  }));
  const events = createMemo(() => {
    if (!isOverlayVisible() || !isRangeSupported()) return [];
    return teamOoo.items().map(mapTeamOooItem);
  });
  const eventsById = createMemo(
    () => new Map(events().map((event) => [event.id, event]))
  );

  return { events, eventsById };
}

/** One teammate absence window for list surfaces. */
export interface TeamOooWindow {
  ownerId: string;
  eventId: string;
  /** Read-only event model used to open the shared event details surface. */
  event: CalendarEvent;
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
  const rangeStart = new Date();
  rangeStart.setHours(0, 0, 0, 0);
  const rangeEnd = new Date(rangeStart);
  rangeEnd.setDate(rangeEnd.getDate() + UPCOMING_TEAM_OOO_DAYS);
  const range = createCalendarOccurrenceQueryRange(rangeStart, rangeEnd);
  const teamOoo = useTeamOooItems(() => range);

  const windows = createMemo<TeamOooWindow[]>(() => {
    // Items arrive only once every window settled, so an errored refetch
    // never surfaces stale rows.
    return teamOoo.items().map((item) => {
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
        event: mapTeamOooItem(item),
        title: item.title ?? undefined,
        start,
        end,
        allDay,
      };
    });
  });

  return {
    windows,
    isPending: teamOoo.isPending,
    isError: teamOoo.isError,
  };
}
