import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calendarKeys } from '../keys';
import { handleRefreshCalendar } from '../sync';

const invalidateQueriesMock = vi.hoisted(() => vi.fn());
const invalidateCalendarOccurrencesMock = vi.hoisted(() => vi.fn());

vi.mock('../../client', () => ({
  queryClient: { invalidateQueries: invalidateQueriesMock },
}));

vi.mock('../occurrences', () => ({
  invalidateCalendarOccurrences: invalidateCalendarOccurrencesMock,
}));

describe('handleRefreshCalendar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refetches occurrence viewports and the calendar list on synced', () => {
    handleRefreshCalendar({
      event: 'synced',
      link_id: '019fdd65-dcc1-74fb-a9c6-8162c11c5854',
    });

    expect(invalidateCalendarOccurrencesMock).toHaveBeenCalledTimes(1);
    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: calendarKeys.visibleCalendars.queryKey,
    });
  });

  it('ignores malformed or unknown payloads', () => {
    handleRefreshCalendar(undefined);
    handleRefreshCalendar('synced');
    handleRefreshCalendar({ event: 42 });
    handleRefreshCalendar({
      event: 'unknown_kind',
      link_id: '019fdd65-dcc1-74fb-a9c6-8162c11c5854',
    });
    handleRefreshCalendar({ event: 'synced' });
    handleRefreshCalendar({ event: 'synced', link_id: 42 });

    expect(invalidateCalendarOccurrencesMock).not.toHaveBeenCalled();
    expect(invalidateQueriesMock).not.toHaveBeenCalled();
  });
});
