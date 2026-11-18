import { storageServiceClient } from '@service-storage/client';
import { ok } from 'neverthrow';
import { afterEach, expect, it, vi } from 'vitest';
import { teamAvailabilityOptions } from './team-availability';

vi.mock('@core/context/user', () => ({ useUserId: () => () => 'viewer' }));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { getTeamAvailability: vi.fn() },
}));
afterEach(() => vi.clearAllMocks());
const range = {
  start: new Date('2030-01-01T10:00Z'),
  end: new Date('2030-01-01T11:00Z'),
};

it('partitions by account, range, and the bounded explicit member set', () => {
  const members = Array.from({ length: 120 }, (_, index) => `member-${index}`);
  const options = teamAvailabilityOptions('viewer', range, [
    ...members,
    members[0],
  ]);
  expect(options.queryKey).not.toEqual(
    teamAvailabilityOptions('another-viewer', range, members).queryKey
  );
  expect(options.queryKey).not.toEqual(
    teamAvailabilityOptions(
      'viewer',
      { ...range, end: new Date('2030-01-01T12:00Z') },
      members
    ).queryKey
  );
  expect(options.queryKey).toEqual(
    teamAvailabilityOptions('viewer', range, [...members].reverse()).queryKey
  );
  expect(options.queryKey.at(-1)).toHaveLength(100);
});
it('forwards cancellation and keeps unknown coverage distinct from known busy data', async () => {
  const data = {
    start: range.start.toISOString(),
    end: range.end.toISOString(),
    complete: false,
    members: [
      {
        userId: 'member',
        busy: [
          { start: range.start.toISOString(), end: range.end.toISOString() },
        ],
        coverage: 'unknown' as const,
        unknownReasons: ['truncated' as const],
      },
    ],
    unknownUserIds: ['external'],
    summary: 'Incomplete coverage',
  };
  vi.mocked(storageServiceClient.getTeamAvailability).mockResolvedValue(
    ok(data)
  );
  const signal = new AbortController().signal;
  const result = await teamAvailabilityOptions('viewer', range, [
    'member',
    'external',
  ]).queryFn({ signal });
  expect(storageServiceClient.getTeamAvailability).toHaveBeenCalledWith(
    {
      start: range.start.toISOString(),
      end: range.end.toISOString(),
      userIds: ['external', 'member'],
    },
    signal
  );
  expect(result).toEqual(data);
  expect(teamAvailabilityOptions(undefined, range, ['member']).enabled).toBe(
    false
  );
  expect(teamAvailabilityOptions('viewer', undefined, ['member']).enabled).toBe(
    false
  );
  expect(teamAvailabilityOptions('viewer', range, []).enabled).toBe(false);
});
