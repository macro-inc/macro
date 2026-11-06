import { ThrownResultError } from '@core/util/result';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useSetAvailabilityCalendarMutation,
  useSetTeamCalendarSharingMutation,
} from '../team';
import { refreshTeamCalendarQueries } from '../team-cache';
import { calendarTeamKeys } from '../team-keys';

const setTeamCalendarSharing = vi.hoisted(() => vi.fn());
const setAvailabilityCalendar = vi.hoisted(() => vi.fn());

vi.mock('@service-email/client', () => ({
  emailClient: { setTeamCalendarSharing, setAvailabilityCalendar },
}));
vi.mock('@service-auth/client', () => ({ authServiceClient: {} }));

let testQueryClient: QueryClient;

vi.mock('../../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));

const identity = { userId: 'alice', teamId: 'team-a' };
const sharingKey = calendarTeamKeys.sharing(identity).queryKey;
const calendarsKey = calendarTeamKeys.availabilityCalendars(identity).queryKey;

let dispose: (() => void) | undefined;

function renderHook<T>(factory: () => T): T {
  let hook!: T;
  dispose = render(
    () => (
      <QueryClientProvider client={testQueryClient}>
        {(() => {
          hook = factory();
          return null as unknown as JSX.Element;
        })()}
      </QueryClientProvider>
    ),
    document.body
  );
  return hook;
}

const failure = () => err([{ code: 'HTTP_ERROR' as const, message: 'no' }]);

beforeEach(() => {
  vi.clearAllMocks();
  testQueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  testQueryClient.clear();
});

describe('team calendar query boundaries', () => {
  it('partitions every policy query by viewer and team', () => {
    const otherUser = { ...identity, userId: 'bob' };
    const otherTeam = { ...identity, teamId: 'team-b' };
    for (const key of [
      calendarTeamKeys.sharing,
      calendarTeamKeys.availabilityCalendars,
    ]) {
      expect(key(identity).queryKey).not.toEqual(key(otherUser).queryKey);
      expect(key(identity).queryKey).not.toEqual(key(otherTeam).queryKey);
    }
  });
});

describe('team sharing changes', () => {
  it('shows the new choice while saving and never clears the setting', async () => {
    testQueryClient.setQueryData(sharingKey, { sharing: 'busy_only' });
    let resolve!: (value: unknown) => void;
    setTeamCalendarSharing.mockReturnValue(
      new Promise((res) => {
        resolve = res;
      })
    );
    const mutation = renderHook(() => useSetTeamCalendarSharingMutation());

    const saving = mutation.mutateAsync({ identity, sharing: 'all' });
    await vi.waitFor(() =>
      expect(testQueryClient.getQueryData(sharingKey)).toEqual({
        sharing: 'all',
      })
    );
    resolve(ok({ sharing: 'all' }));
    await saving;

    expect(setTeamCalendarSharing).toHaveBeenCalledWith({ sharing: 'all' });
    expect(testQueryClient.getQueryData(sharingKey)).toEqual({
      sharing: 'all',
    });
  });

  it('restores the saved choice when the change fails', async () => {
    testQueryClient.setQueryData(sharingKey, { sharing: 'busy_only' });
    setTeamCalendarSharing.mockResolvedValue(failure());
    const mutation = renderHook(() => useSetTeamCalendarSharingMutation());

    await expect(
      mutation.mutateAsync({ identity, sharing: 'none' })
    ).rejects.toBeDefined();

    expect(testQueryClient.getQueryData(sharingKey)).toEqual({
      sharing: 'busy_only',
    });
  });

  it('leaves a saving choice to its save when a sharing push arrives', async () => {
    testQueryClient.setQueryData(sharingKey, { sharing: 'busy_only' });
    let finish!: (value: unknown) => void;
    setTeamCalendarSharing.mockReturnValue(
      new Promise((res) => {
        finish = res;
      })
    );
    const mutation = renderHook(() => useSetTeamCalendarSharingMutation());

    const saving = mutation.mutateAsync({ identity, sharing: 'all' });
    await vi.waitFor(() =>
      expect(setTeamCalendarSharing).toHaveBeenCalledTimes(1)
    );
    await refreshTeamCalendarQueries();
    expect(testQueryClient.getQueryState(sharingKey)?.isInvalidated).toBe(
      false
    );
    expect(testQueryClient.getQueryData(sharingKey)).toEqual({
      sharing: 'all',
    });

    finish(ok({ sharing: 'all' }));
    await saving;
    expect(testQueryClient.getQueryState(sharingKey)?.isInvalidated).toBe(true);
  });

  it('sends quick changes in order and keeps the newest choice when an earlier one fails', async () => {
    testQueryClient.setQueryData(sharingKey, { sharing: 'busy_only' });
    let failFirst!: (value: unknown) => void;
    setTeamCalendarSharing
      .mockReturnValueOnce(
        new Promise((res) => {
          failFirst = res;
        })
      )
      .mockResolvedValueOnce(ok({ sharing: 'none' }));
    const mutation = renderHook(() => useSetTeamCalendarSharingMutation());

    const first = mutation.mutateAsync({ identity, sharing: 'all' });
    await vi.waitFor(() =>
      expect(setTeamCalendarSharing).toHaveBeenCalledTimes(1)
    );
    const second = mutation.mutateAsync({ identity, sharing: 'none' });
    await vi.waitFor(() =>
      expect(testQueryClient.getQueryData(sharingKey)).toEqual({
        sharing: 'none',
      })
    );
    expect(setTeamCalendarSharing).toHaveBeenCalledTimes(1);

    failFirst(failure());
    await expect(first).rejects.toBeDefined();
    expect(testQueryClient.getQueryData(sharingKey)).toEqual({
      sharing: 'none',
    });
    await second;
    expect(setTeamCalendarSharing).toHaveBeenLastCalledWith({
      sharing: 'none',
    });
    expect(testQueryClient.getQueryData(sharingKey)).toEqual({
      sharing: 'none',
    });
  });
});

describe('availability calendar changes', () => {
  const calendars = {
    calendars: [
      {
        calendarId: 'primary',
        name: 'Primary',
        isPrimary: true,
        contributesToAvailability: true,
      },
      {
        calendarId: 'holidays',
        name: 'Holidays',
        isPrimary: false,
        contributesToAvailability: false,
      },
      {
        calendarId: 'other-account',
        name: 'Other account',
        isPrimary: true,
        contributesToAvailability: true,
      },
    ],
  };
  const included = () =>
    (
      testQueryClient.getQueryData(calendarsKey) as typeof calendars
    ).calendars.map((calendar) => calendar.contributesToAvailability);

  it('saves an account group in one step and updates only its calendars', async () => {
    testQueryClient.setQueryData(calendarsKey, calendars);
    setAvailabilityCalendar.mockResolvedValue(ok({}));
    const mutation = renderHook(() => useSetAvailabilityCalendarMutation());

    await mutation.mutateAsync({
      identity,
      calendarIds: ['primary', 'holidays'],
      contributesToAvailability: false,
    });

    expect(setAvailabilityCalendar).toHaveBeenCalledTimes(2);
    expect(setAvailabilityCalendar).toHaveBeenCalledWith('holidays', {
      contributesToAvailability: false,
    });
    expect(included()).toEqual([false, false, true]);
  });

  it('waits for every save and restores only the calendars that failed', async () => {
    testQueryClient.setQueryData(calendarsKey, calendars);
    let finishPrimary!: (value: unknown) => void;
    setAvailabilityCalendar
      .mockReturnValueOnce(
        new Promise((res) => {
          finishPrimary = res;
        })
      )
      .mockResolvedValueOnce(failure());
    const mutation = renderHook(() => useSetAvailabilityCalendarMutation());

    let settled = false;
    const save = async () => {
      try {
        await mutation.mutateAsync({
          identity,
          calendarIds: ['primary', 'holidays'],
          contributesToAvailability: false,
        });
      } finally {
        settled = true;
      }
    };
    const saving = save();
    await vi.waitFor(() =>
      expect(setAvailabilityCalendar).toHaveBeenCalledTimes(2)
    );
    await Promise.resolve();
    expect(settled).toBe(false);

    finishPrimary(ok({}));
    // The client's own error keeps the codes retry and auth handling read.
    await expect(saving).rejects.toBeInstanceOf(ThrownResultError);

    expect(included()).toEqual([false, false, true]);
  });

  it('restores a failed calendar to its previous value', async () => {
    testQueryClient.setQueryData(calendarsKey, calendars);
    setAvailabilityCalendar
      .mockResolvedValueOnce(failure())
      .mockResolvedValueOnce(ok({}));
    const mutation = renderHook(() => useSetAvailabilityCalendarMutation());

    await expect(
      mutation.mutateAsync({
        identity,
        calendarIds: ['primary', 'other-account'],
        contributesToAvailability: false,
      })
    ).rejects.toBeDefined();

    expect(included()).toEqual([true, false, false]);
  });
});
