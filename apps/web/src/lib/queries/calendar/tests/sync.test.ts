import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calendarKeys } from '../keys';
import { handleRefreshCalendar } from '../sync';

const invalidateQueriesMock = vi.hoisted(() => vi.fn());
const isMutatingMock = vi.hoisted(() => vi.fn());
const invalidateCalendarOccurrencesMock = vi.hoisted(() => vi.fn());
const refreshTeamCalendarQueriesMock = vi.hoisted(() => vi.fn());

vi.mock('../team-cache', () => ({
  refreshTeamCalendarQueries: refreshTeamCalendarQueriesMock,
}));

vi.mock('../../client', () => ({
  queryClient: {
    invalidateQueries: invalidateQueriesMock,
    isMutating: isMutatingMock,
  },
}));

vi.mock('../occurrences', () => ({
  invalidateCalendarOccurrences: invalidateCalendarOccurrencesMock,
}));

describe('handleRefreshCalendar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isMutatingMock.mockReturnValue(0);
  });

  it('refetches occurrence viewports and the calendar list on synced', () => {
    handleRefreshCalendar({
      event: 'synced',
      link_id: '019fdd65-dcc1-74fb-a9c6-8162c11c5854',
    });

    expect(invalidateCalendarOccurrencesMock).toHaveBeenCalledTimes(1);
    expect(refreshTeamCalendarQueriesMock).toHaveBeenCalledWith({
      outOfOfficeChanged: true,
    });
    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: calendarKeys.invitations._def,
    });
    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: calendarKeys.visibleCalendars.queryKey,
    });
  });

  it('defers the occurrence refetch while an RSVP is in flight', () => {
    isMutatingMock.mockReturnValue(1);

    handleRefreshCalendar({
      event: 'synced',
      link_id: '019fdd65-dcc1-74fb-a9c6-8162c11c5854',
    });

    expect(invalidateCalendarOccurrencesMock).not.toHaveBeenCalled();
    expect(invalidateQueriesMock).not.toHaveBeenCalledWith({
      queryKey: calendarKeys.invitations._def,
    });
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

  it('clears team projections on sharing changes without touching own optimistic events', () => {
    handleRefreshCalendar({ event: 'team_sharing_changed' });
    expect(refreshTeamCalendarQueriesMock).toHaveBeenCalledWith({
      outOfOfficeChanged: true,
    });
    expect(invalidateCalendarOccurrencesMock).not.toHaveBeenCalled();
  });

  it.each(['synced', 'team_sharing_changed'])(
    'keeps OOO rows when %s explicitly excludes OOO changes',
    (event) => {
      handleRefreshCalendar({
        event,
        link_id: 'inbox',
        team_ooo_changed: false,
      });
      expect(refreshTeamCalendarQueriesMock).toHaveBeenCalledWith({
        outOfOfficeChanged: false,
      });
    }
  );

  it.each([true, undefined, null, 'false', 0])(
    'clears OOO rows for a missing or unsafe hint: %s',
    (team_ooo_changed) => {
      handleRefreshCalendar({
        event: 'team_sharing_changed',
        team_ooo_changed,
      });
      expect(refreshTeamCalendarQueriesMock).toHaveBeenCalledWith({
        outOfOfficeChanged: true,
      });
    }
  );
});
