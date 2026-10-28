import { previewKeys } from '@queries/preview/keys';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  isAlreadyOnCalendar,
  useCopySharedCalendarEventMutation,
} from '../copy';
import { calendarKeys } from '../keys';

const copyCalendarEventMock = vi.hoisted(() => vi.fn());

vi.mock('@service-email/client', () => ({
  emailClient: { copyCalendarEvent: copyCalendarEventMock },
}));

let testQueryClient: QueryClient;

vi.mock('../../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));

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

it('copies onto the picked calendar and refreshes the mention and the calendar', async () => {
  copyCalendarEventMock.mockResolvedValue(ok({ id: 'copy-1' }));
  const invalidateSpy = vi.spyOn(testQueryClient, 'invalidateQueries');
  const copy = renderHook(() => useCopySharedCalendarEventMutation());

  const copied = await copy.mutateAsync({
    eventId: 'shared-event',
    calendarId: 'calendar-team',
  });

  expect(copied.id).toBe('copy-1');
  expect(copyCalendarEventMock).toHaveBeenCalledWith('shared-event', {
    calendarId: 'calendar-team',
  });
  expect(invalidateSpy).toHaveBeenCalledWith({
    queryKey: previewKeys.item('shared-event').queryKey,
  });
  expect(invalidateSpy).toHaveBeenCalledWith({
    queryKey: calendarKeys.occurrences._def,
  });
});

// The server syncs in the copy Google already held, so the mention still
// refreshes to resolve to it.
it('refreshes the mention when the meeting was already on a calendar', async () => {
  copyCalendarEventMock.mockResolvedValue(
    err([
      {
        code: 'already_on_calendar',
        message: 'this event is already on one of your calendars',
      },
    ])
  );
  const invalidateSpy = vi.spyOn(testQueryClient, 'invalidateQueries');
  const copy = renderHook(() => useCopySharedCalendarEventMutation());

  await expect(copy.mutateAsync({ eventId: 'shared-event' })).rejects.toSatisfy(
    isAlreadyOnCalendar
  );
  expect(invalidateSpy).toHaveBeenCalledWith({
    queryKey: previewKeys.item('shared-event').queryKey,
  });
});
