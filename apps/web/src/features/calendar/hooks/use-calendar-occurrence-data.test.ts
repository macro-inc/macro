import type {
  CalendarOccurrenceQueryRange,
  CalendarOccurrencesData,
  CalendarOccurrencesQueryOptions,
} from '@queries/calendar/occurrences';
import type { CalendarOccurrenceItem } from '@service-storage/generated/schemas/calendarOccurrenceItem';
import { CalendarSyncStatus } from '@service-storage/generated/schemas/calendarSyncStatus';
import { type Accessor, batch, createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { useCalendarOccurrenceData } from './use-calendar-occurrence-data';

type QueryState = {
  isSuccess: boolean;
  isPending: boolean;
  isPlaceholderData: boolean;
  isFetching: boolean;
  data?: CalendarOccurrencesData;
};

let queryState: Accessor<QueryState>;
let queryOptions: Accessor<CalendarOccurrencesQueryOptions>;
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'user-1' }));
vi.mock('@queries/calendar/occurrences', () => ({
  useCalendarOccurrencesQuery: (
    _input: unknown,
    options: Accessor<CalendarOccurrencesQueryOptions>
  ) => {
    queryOptions = options;
    return {
      get isSuccess() {
        return queryState().isSuccess;
      },
      get isPending() {
        return queryState().isPending;
      },
      get isPlaceholderData() {
        return queryState().isPlaceholderData;
      },
      get isFetching() {
        return queryState().isFetching;
      },
      get data() {
        if (!queryState().isSuccess) throw new Error('Pending data read');
        return queryState().data;
      },
    };
  },
}));

const range = (offset: number): CalendarOccurrenceQueryRange => {
  const start = new Date();
  start.setDate(start.getDate() + offset);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
};

const item = (id: string): CalendarOccurrenceItem => ({
  event: {
    id,
    ownerId: 'macro|user-1',
    icalUid: id,
    calendarId: null,
    title: id,
    status: 'confirmed',
    visibility: 'private',
    transparency: 'opaque',
    eventType: 'default',
    time: {
      kind: 'timed',
      startsAt: '2026-09-10T13:00:00Z',
      endsAt: '2026-09-10T14:00:00Z',
    },
    recurrenceLines: [],
    sequence: 0,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    isReadOnly: false,
    sources: [],
    attendees: [],
  },
  occurrence: {
    eventId: id,
    occurrenceKey: id,
    isCancelled: false,
    time: {
      kind: 'timed',
      startsAt: '2026-09-10T13:00:00Z',
      endsAt: '2026-09-10T14:00:00Z',
    },
  },
});

const data = (
  id: string,
  syncStatus: CalendarOccurrencesData['syncStatus'] = CalendarSyncStatus.ready
): CalendarOccurrencesData => ({
  items: [item(id)],
  syncStatus,
});
const pending: QueryState = {
  isSuccess: false,
  isPending: true,
  isPlaceholderData: false,
  isFetching: false,
};

function harness(initial: QueryState) {
  return createRoot((dispose) => {
    const [state, setState] = createSignal(initial);
    const [currentRange, setRange] = createSignal<
      CalendarOccurrenceQueryRange | undefined
    >(range(0));
    const [enabled, setEnabled] = createSignal(true);
    queryState = state;
    const result = useCalendarOccurrenceData({
      range: currentRange,
      queryOptions: () => ({ enabled: enabled() }),
    });
    return { result, setState, setRange, setEnabled, dispose };
  });
}

it('does not read pending or disabled query data', () => {
  const { result, setRange, setEnabled, dispose } = harness(pending);
  try {
    expect(result.events()).toEqual([]);
    expect(result.visibleEvents()).toEqual([]);
    expect(result.eventsById().size).toBe(0);
    expect(result.isSyncing()).toBe(false);
    expect(result.isLoading()).toBe(true);

    setEnabled(false);
    expect(queryOptions().enabled).toBe(false);
    expect(result.events()).toEqual([]);
    expect(result.isSyncing()).toBe(false);
    setRange(undefined);
    expect(queryOptions().enabled).toBe(false);
    expect(result.events()).toEqual([]);
    expect(result.isSyncing()).toBe(false);
  } finally {
    dispose();
  }
});

it('hides previous-range placeholder events and sync status until the new range succeeds', () => {
  const { result, setRange, setState, dispose } = harness({
    isSuccess: true,
    isPending: false,
    isPlaceholderData: false,
    isFetching: false,
    data: data('old', CalendarSyncStatus.syncing),
  });
  try {
    expect(result.events().map((event) => event.eventId)).toEqual(['old']);
    expect(result.isSyncing()).toBe(true);
    batch(() => {
      setRange(range(7));
      setState({
        isSuccess: true,
        isPending: false,
        isPlaceholderData: true,
        isFetching: true,
        data: data('old', CalendarSyncStatus.syncing),
      });
    });
    expect(result.events()).toEqual([]);
    expect(result.visibleEvents()).toEqual([]);
    expect(result.eventsById().size).toBe(0);
    expect(result.isSyncing()).toBe(false);
    expect(result.isLoading()).toBe(true);

    setState({
      isSuccess: true,
      isPending: false,
      isPlaceholderData: false,
      isFetching: false,
      data: data('new'),
    });
    expect(result.events().map((event) => event.eventId)).toEqual(['new']);
    expect(result.isSyncing()).toBe(false);
  } finally {
    dispose();
  }
});

it('keeps successful events and sync status during a background refetch', () => {
  const { result, setState, dispose } = harness({
    isSuccess: true,
    isPending: false,
    isPlaceholderData: false,
    isFetching: false,
    data: data('current', CalendarSyncStatus.syncing),
  });
  try {
    setState({
      isSuccess: true,
      isPending: false,
      isPlaceholderData: false,
      isFetching: true,
      data: data('current', CalendarSyncStatus.syncing),
    });
    expect(result.events().map((event) => event.eventId)).toEqual(['current']);
    expect(result.visibleEvents().map((event) => event.eventId)).toEqual([
      'current',
    ]);
    expect(result.eventsById().size).toBe(1);
    expect(result.isSyncing()).toBe(true);
    expect(result.isLoading()).toBe(false);
  } finally {
    dispose();
  }
});
