import { ThrownResultError } from '@core/util/result';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSetAvailabilityCalendarMutation } from '../availability';
import { calendarKeys } from '../keys';

const setAvailabilityCalendar = vi.hoisted(() => vi.fn());

vi.mock('@service-email/client', () => ({
  emailClient: { setAvailabilityCalendar },
}));

let testQueryClient: QueryClient;

vi.mock('../../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));

const userId = 'alice';
const calendarsKey = calendarKeys.availabilityCalendars(userId).queryKey;

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

it("keeps each viewer's setting apart", () => {
  expect(calendarsKey).not.toEqual(
    calendarKeys.availabilityCalendars('bob').queryKey
  );
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
      userId,
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
          userId,
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
        userId,
        calendarIds: ['primary', 'other-account'],
        contributesToAvailability: false,
      })
    ).rejects.toBeDefined();

    expect(included()).toEqual([true, false, false]);
  });
});
