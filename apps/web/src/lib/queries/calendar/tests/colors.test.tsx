import type { VisibleCalendar } from '@service-calendar/generated/schemas/visibleCalendar';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSetCalendarColorMutation } from '../colors';
import { calendarKeys } from '../keys';

const setCalendarColor = vi.hoisted(() => vi.fn());
const graphqlHost = vi.hoisted(() => vi.fn());
const executeGraphqlSetCalendarColor = vi.hoisted(() => vi.fn());

vi.mock('@service-email/client', () => ({
  emailClient: { setCalendarColor },
}));
vi.mock('../graphql/flag', () => ({
  answeringGraphqlCalendarHost: graphqlHost,
}));
vi.mock('../graphql/mutations', () => ({
  executeGraphqlSetCalendarColor,
}));

let testQueryClient: QueryClient;

vi.mock('../../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));

const userId = 'alice';
const listKey = calendarKeys.visibleCalendars(userId).queryKey;
const cachedListKey =
  calendarKeys.visibleCalendars(userId)._ctx.graphql.queryKey;

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

function calendar(id: string, customColor: string | null): VisibleCalendar {
  return {
    id,
    emailLinkId: 'link',
    emailAddress: 'alice@example.com',
    name: id,
    color: '#9fe1e7',
    customColor,
    provider: 'google',
    capabilities: {
      autoDecline: true,
      conferenceProvider: 'google_meet',
      customRecurrence: true,
      emailReminders: true,
      removeConference: true,
      resetRsvp: true,
      guestPolicy: true,
    },
    isPrimary: id === 'primary',
    isWritable: true,
    isSubscription: false,
    contributesToAvailability: true,
    syncError: null,
    defaultReminders: [],
  };
}

const customColors = (key: readonly unknown[]) =>
  testQueryClient
    .getQueryData<VisibleCalendar[]>(key)
    ?.map((entry) => [entry.id, entry.customColor]);

beforeEach(() => {
  vi.clearAllMocks();
  graphqlHost.mockReturnValue(undefined);
  testQueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  testQueryClient.clear();
});

describe('calendar color saves over REST', () => {
  it('shows the color on every list at once and sends it to the server', async () => {
    testQueryClient.setQueryData(listKey, [
      calendar('primary', null),
      calendar('work', '#ed6a86'),
    ]);
    testQueryClient.setQueryData(cachedListKey, [calendar('primary', null)]);
    const response = Promise.withResolvers<unknown>();
    const sent = Promise.withResolvers<void>();
    setCalendarColor.mockImplementation(() => {
      sent.resolve();
      return response.promise;
    });
    const mutation = renderHook(() => useSetCalendarColorMutation());

    const saved = mutation.mutateAsync({
      userId,
      calendarId: 'primary',
      color: '#5c8aee',
    });
    await sent.promise;

    expect(customColors(listKey)).toEqual([
      ['primary', '#5c8aee'],
      ['work', '#ed6a86'],
    ]);
    expect(customColors(cachedListKey)).toEqual([['primary', '#5c8aee']]);
    response.resolve(ok({}));
    await saved;

    expect(setCalendarColor).toHaveBeenCalledExactlyOnceWith('primary', {
      color: '#5c8aee',
    });
    expect(testQueryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
  });

  it("puts back only that calendar's color when the save fails", async () => {
    testQueryClient.setQueryData(listKey, [
      calendar('primary', '#ed6a86'),
      calendar('work', null),
    ]);
    setCalendarColor.mockResolvedValue(
      err([{ code: 'HTTP_ERROR' as const, message: 'no' }])
    );
    const mutation = renderHook(() => useSetCalendarColorMutation());

    await expect(
      mutation.mutateAsync({ userId, calendarId: 'primary', color: null })
    ).rejects.toThrow();

    expect(customColors(listKey)).toEqual([
      ['primary', '#ed6a86'],
      ['work', null],
    ]);
  });
});

describe('calendar color saves through the cache', () => {
  it('leaves the lists to the cache, which shows the color on the calendar record', async () => {
    graphqlHost.mockReturnValue({});
    executeGraphqlSetCalendarColor.mockResolvedValue({ kind: 'committed' });
    testQueryClient.setQueryData(cachedListKey, [calendar('primary', null)]);
    const mutation = renderHook(() => useSetCalendarColorMutation());

    await mutation.mutateAsync({
      userId,
      calendarId: 'primary',
      color: '#5c8aee',
    });

    expect(executeGraphqlSetCalendarColor).toHaveBeenCalledExactlyOnceWith({
      userId,
      calendarId: 'primary',
      color: '#5c8aee',
    });
    expect(setCalendarColor).not.toHaveBeenCalled();
    expect(customColors(cachedListKey)).toEqual([['primary', null]]);
    expect(testQueryClient.getQueryState(cachedListKey)?.isInvalidated).toBe(
      false
    );
  });
});
