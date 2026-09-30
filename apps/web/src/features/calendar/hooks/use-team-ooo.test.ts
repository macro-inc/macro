import type { CalendarOccurrenceQueryRange } from '@queries/calendar/occurrences';
import type { TeamOutOfOfficeItem } from '@service-storage/generated/schemas/teamOutOfOfficeItem';
import { type Accessor, createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { useTeamOooEvents } from './use-team-ooo';

type QueryState = {
  isSuccess: boolean;
  isPlaceholderData: boolean;
  isFetching: boolean;
  data: TeamOutOfOfficeItem[];
};
let queryState: Accessor<QueryState>;
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'viewer' }));
vi.mock('@core/user', () => ({
  getDisplayName: () => 'Teammate',
  tryMacroId: (value: string) => value,
}));
vi.mock('@queries/team/teams', () => ({ useCurrentTeamQuery: vi.fn() }));
vi.mock('./use-calendar-ui-flag', () => ({
  useCalendarTeamOooFlag: () => () => true,
}));
vi.mock('@queries/calendar/occurrences', () => ({
  createCalendarOccurrenceQueryRange: vi.fn(),
}));
vi.mock('@queries/calendar/team-ooo', () => ({
  useTeamOutOfOfficeQuery: () => ({
    get isSuccess() {
      return queryState().isSuccess;
    },
    get isPlaceholderData() {
      return queryState().isPlaceholderData;
    },
    get data() {
      if (!queryState().isSuccess || queryState().isPlaceholderData) {
        throw new Error('Pending or previous-range team data read');
      }
      return queryState().data;
    },
  }),
}));

function item(eventId: string): TeamOutOfOfficeItem {
  return {
    eventId,
    occurrenceKey: eventId,
    ownerId: 'teammate',
    time: {
      kind: 'timed',
      startsAt: '2026-09-29T10:00:00Z',
      endsAt: '2026-09-29T11:00:00Z',
    },
  };
}
function harness(initial: QueryState) {
  return createRoot((dispose) => {
    const [state, setState] = createSignal(initial);
    queryState = state;
    const start = new Date();
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    const range: CalendarOccurrenceQueryRange = {
      start: start.toISOString(),
      end: end.toISOString(),
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
    };
    const events = useTeamOooEvents({ range: () => range });
    return { events, setState, dispose };
  });
}

describe('team out-of-office loading', () => {
  it('does not read pending query data', () => {
    const { events, dispose } = harness({
      isSuccess: false,
      isPlaceholderData: false,
      isFetching: true,
      data: [],
    });
    try {
      expect(events.events()).toEqual([]);
      expect(events.visibleEvents()).toEqual([]);
      expect(events.eventsById().size).toBe(0);
    } finally {
      dispose();
    }
  });

  it('hides previous-range events until current data succeeds', () => {
    const { events, setState, dispose } = harness({
      isSuccess: true,
      isPlaceholderData: false,
      isFetching: false,
      data: [item('old')],
    });
    try {
      expect(events.events().map((event) => event.eventId)).toEqual(['old']);
      setState({
        isSuccess: true,
        isPlaceholderData: true,
        isFetching: true,
        data: [item('old')],
      });
      expect(events.events()).toEqual([]);
      expect(events.visibleEvents()).toEqual([]);
      expect(events.eventsById().size).toBe(0);
      setState({
        isSuccess: true,
        isPlaceholderData: false,
        isFetching: false,
        data: [item('new')],
      });
      expect(events.visibleEvents().map((event) => event.eventId)).toEqual([
        'new',
      ]);
    } finally {
      dispose();
    }
  });

  it('keeps current events visible during background refresh', () => {
    const { events, dispose } = harness({
      isSuccess: true,
      isPlaceholderData: false,
      isFetching: true,
      data: [item('current')],
    });
    try {
      expect(events.visibleEvents().map((event) => event.eventId)).toEqual([
        'current',
      ]);
      expect(events.eventsById().size).toBe(1);
    } finally {
      dispose();
    }
  });
});
