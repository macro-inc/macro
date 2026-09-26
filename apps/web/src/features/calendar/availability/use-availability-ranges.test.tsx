/**
 * @vitest-environment jsdom
 */

import type { CalendarOccurrenceItem } from '@service-storage/generated/schemas/calendarOccurrenceItem';
import { CalendarSyncStatus } from '@service-storage/generated/schemas/calendarSyncStatus';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  type AvailabilitySettings,
  DEFAULT_AVAILABILITY_SETTINGS,
} from './availability';
import { useAvailabilityRanges } from './use-availability-ranges';

const mocks = vi.hoisted(() => ({
  queryInput: vi.fn(),
  data: vi.fn(),
  fetchQuery: vi.fn(),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'user-1' }));
vi.mock('@queries/client', () => ({
  queryClient: { fetchQuery: mocks.fetchQuery },
}));
vi.mock('@queries/calendar/occurrences', () => ({
  createCalendarOccurrenceQueryRange: (start: Date, end: Date) => ({
    start: start.toISOString(),
    end: end.toISOString(),
  }),
  fetchCalendarOccurrences: vi.fn(),
  useCalendarOccurrencesQuery: (input: () => unknown) => {
    mocks.queryInput(input());
    return {
      isSuccess: true,
      isPlaceholderData: false,
      isError: false,
      get data() {
        return mocks.data();
      },
      refetch: vi.fn(),
    };
  },
}));

const busyToday = {
  event: { status: 'confirmed', transparency: 'opaque', attendees: [] },
  occurrence: {
    isCancelled: false,
    time: {
      kind: 'timed',
      startsAt: new Date(2026, 7, 24, 9).toISOString(),
      endsAt: new Date(2026, 7, 24, 18).toISOString(),
    },
  },
} as unknown as CalendarOccurrenceItem;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 24, 10));
  mocks.data.mockReturnValue({
    items: [busyToday],
    syncStatus: CalendarSyncStatus.ready,
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

it('checks all ranges from one largest-range query and recomputes when settings change', () => {
  let changeSettings!: (value: AvailabilitySettings) => void;
  render(() => {
    const [settings, setSettings] = createSignal(DEFAULT_AVAILABILITY_SETTINGS);
    changeSettings = setSettings;
    const availability = useAvailabilityRanges(settings);
    return (
      <div>
        <span data-testid="today">{availability.days()?.today.length}</span>
        <span data-testid="week">{availability.days()?.thisWeek.length}</span>
        <span data-testid="seven">{availability.days()?.next7Days.length}</span>
        <span data-testid="fourteen">
          {availability.days()?.next14Days.length}
        </span>
      </div>
    );
  });

  expect(mocks.queryInput).toHaveBeenCalledOnce();
  expect(mocks.queryInput.mock.calls[0][0].range.end).toBe(
    new Date(2026, 8, 8).toISOString()
  );
  expect(screen.getByTestId('today').textContent).toBe('0');
  expect(screen.getByTestId('week').textContent).toBe('4');
  expect(screen.getByTestId('seven').textContent).toBe('5');
  expect(screen.getByTestId('fourteen').textContent).toBe('10');

  changeSettings({ ...DEFAULT_AVAILABILITY_SETTINGS, endTime: '19:00' });
  expect(screen.getByTestId('today').textContent).toBe('1');
  expect(mocks.queryInput).toHaveBeenCalledOnce();
});
it('refetches before copying and excludes slots that have passed since opening', async () => {
  vi.setSystemTime(new Date(2026, 7, 24, 10, 14, 59));
  mocks.data.mockReturnValue({
    items: [],
    syncStatus: CalendarSyncStatus.ready,
  });
  mocks.fetchQuery.mockResolvedValue({
    items: [],
    syncStatus: CalendarSyncStatus.ready,
  });
  let refreshRange!: ReturnType<typeof useAvailabilityRanges>['refreshRange'];
  render(() => {
    refreshRange = useAvailabilityRanges(
      () => DEFAULT_AVAILABILITY_SETTINGS
    ).refreshRange;
    return <div />;
  });

  vi.setSystemTime(new Date(2026, 7, 24, 10, 15, 2));
  const result = await refreshRange('today');
  expect(result?.days[0].slots[0].start).toEqual(new Date(2026, 7, 24, 10, 30));
  expect(mocks.fetchQuery).toHaveBeenCalledWith(
    expect.objectContaining({ staleTime: 0 })
  );
});

it('uses refreshed busy events instead of the initial snapshot', async () => {
  mocks.data.mockReturnValue({
    items: [],
    syncStatus: CalendarSyncStatus.ready,
  });
  mocks.fetchQuery.mockResolvedValue({
    items: [busyToday],
    syncStatus: CalendarSyncStatus.ready,
  });
  let refreshRange!: ReturnType<typeof useAvailabilityRanges>['refreshRange'];
  render(() => {
    refreshRange = useAvailabilityRanges(
      () => DEFAULT_AVAILABILITY_SETTINGS
    ).refreshRange;
    return <div />;
  });

  expect((await refreshRange('today'))?.days).toEqual([]);
  expect(mocks.fetchQuery).toHaveBeenCalledOnce();
});
