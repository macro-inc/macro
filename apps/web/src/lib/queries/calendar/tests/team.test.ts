import { storageServiceClient } from '@service-storage/client';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchTeamCalendar, fetchTeamCalendarMembers } from '../team';
import { calendarTeamKeys } from '../team-keys';

vi.mock('@service-storage/client', () => ({
  storageServiceClient: { listTeamCalendar: vi.fn() },
}));
vi.mock('@service-auth/client', () => ({ authServiceClient: {} }));
vi.mock('@service-email/client', () => ({ emailClient: {} }));
vi.mock('../team-cache', () => ({ resetTeamCalendarQueries: vi.fn() }));

const range = {
  start: '2026-10-07T00:00:00Z',
  end: '2026-10-08T00:00:00Z',
  startDate: '2026-10-07',
  endDate: '2026-10-08',
};
const item = {
  id: 'opaque',
  ownerId: 'alice',
  kind: 'busy' as const,
  contributesToAvailability: true,
  time: {
    kind: 'timed' as const,
    startsAt: range.start,
    endsAt: range.end,
    timeZone: null,
  },
};

describe('team calendar query boundaries', () => {
  beforeEach(() => vi.clearAllMocks());

  it('partitions every policy and event query by viewer and team', () => {
    const first = { userId: 'alice', teamId: 'team-a' };
    const otherUser = { ...first, userId: 'bob' };
    const otherTeam = { ...first, teamId: 'team-b' };
    for (const key of [
      calendarTeamKeys.sharing,
      calendarTeamKeys.availabilityCalendars,
    ]) {
      expect(key(first).queryKey).not.toEqual(key(otherUser).queryKey);
      expect(key(first).queryKey).not.toEqual(key(otherTeam).queryKey);
    }
    expect(calendarTeamKeys.events(first, range).queryKey).not.toEqual(
      calendarTeamKeys.events(otherTeam, range).queryKey
    );
  });

  it('follows all pages and replaces a duplicate projection whole', async () => {
    const updated = { ...item, contributesToAvailability: false };
    vi.mocked(storageServiceClient.listTeamCalendar)
      .mockResolvedValueOnce(
        ok({ members: [], items: [item], nextCursor: 'cursor' })
      )
      .mockResolvedValueOnce(
        ok({ members: [], items: [updated], nextCursor: null })
      );
    const controller = new AbortController();
    expect((await fetchTeamCalendar(range, controller.signal)).items).toEqual([
      updated,
    ]);
    expect(storageServiceClient.listTeamCalendar).toHaveBeenLastCalledWith({
      start: range.start,
      end: range.end,
      cursor: 'cursor',
      limit: 500,
      signal: controller.signal,
    });
  });

  it('loads the roster without asking the server to scan source events', async () => {
    const members = [
      {
        userId: 'alice',
        sharing: 'busy_only' as const,
        coverage: 'ready' as const,
      },
    ];
    vi.mocked(storageServiceClient.listTeamCalendar).mockResolvedValueOnce(
      ok({ members, items: [], nextCursor: null })
    );
    const controller = new AbortController();

    expect(await fetchTeamCalendarMembers(controller.signal)).toEqual(members);
    expect(storageServiceClient.listTeamCalendar).toHaveBeenCalledTimes(1);
    expect(storageServiceClient.listTeamCalendar).toHaveBeenCalledWith({
      start: expect.stringMatching(/T00:00:00\.000Z$/),
      end: expect.stringMatching(/T00:00:00\.000Z$/),
      limit: 0,
      signal: controller.signal,
    });
  });

  it('rejects a partial range when access changes or continuation repeats', async () => {
    vi.mocked(storageServiceClient.listTeamCalendar)
      .mockResolvedValueOnce(
        ok({ members: [], items: [item], nextCursor: 'cursor' })
      )
      .mockResolvedValueOnce(
        err([{ code: 'FORBIDDEN' as const, message: 'Access changed' }])
      );
    await expect(fetchTeamCalendar(range)).rejects.toThrow();
    vi.mocked(storageServiceClient.listTeamCalendar).mockResolvedValue(
      ok({ members: [], items: [item], nextCursor: 'cursor' })
    );
    await expect(fetchTeamCalendar(range)).rejects.toThrow('repeated cursor');
  });
});
