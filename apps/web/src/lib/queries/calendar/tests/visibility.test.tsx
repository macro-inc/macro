import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mapCalendarOccurrence } from '../graphql/map';
import { graphqlOccurrence } from '../graphql/tests/fixtures';
import { calendarKeys } from '../keys';
import { useUpdateCalendarEventMutation } from '../mutations';
import type { CalendarOccurrencesData } from '../occurrences';

const update = vi.hoisted(() => vi.fn());
let client: QueryClient;
vi.mock('@queries/client', () => ({
  get queryClient() {
    return client;
  },
}));
vi.mock('@service-email/client', () => ({
  emailClient: { updateCalendarEvent: update },
}));
vi.mock('../graphql/flag', () => ({
  answeringGraphqlCalendarHost: () => undefined,
  graphqlCalendarHost: () => undefined,
  useGraphqlCalendarHost: () => () => undefined,
  markCalendarCacheUnsupported: vi.fn(),
}));

const key = calendarKeys.occurrences('user', {
  start: '2026-10-01T00:00:00Z',
  end: '2026-11-01T00:00:00Z',
  startDate: '2026-10-01',
  endDate: '2026-11-01',
}).queryKey;

function mountMutation() {
  const mounted: {
    mutation?: ReturnType<typeof useUpdateCalendarEventMutation>;
  } = {};
  function Capture() {
    mounted.mutation = useUpdateCalendarEventMutation();
    return null;
  }
  render(() => (
    <QueryClientProvider client={client}>
      <Capture />
    </QueryClientProvider>
  ));
  if (!mounted.mutation) throw new Error('Mutation did not mount');
  return mounted.mutation;
}
const cached = () =>
  client.getQueryData<CalendarOccurrencesData>(key)?.items[0];

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData<CalendarOccurrencesData>(key, {
    items: [mapCalendarOccurrence(graphqlOccurrence())],
    syncStatus: 'ready',
  });
});
afterEach(() => {
  cleanup();
  client.clear();
});

describe('optimistic visibility writes', () => {
  it('updates the addressed copy without changing canonical visibility', async () => {
    const response = Promise.withResolvers<ReturnType<typeof ok>>();
    update.mockReturnValue(response.promise);
    const mutation = mountMutation();
    const pending = mutation.mutateAsync({
      eventId: 'event-1',
      calendarId: 'calendar-2',
      patch: { visibility: 'public' },
    });
    await waitFor(() =>
      expect(cached()?.event.sources?.[1].visibility).toBe('public')
    );
    expect(cached()?.event.visibility).toBe('default');
    expect(cached()?.event.sources?.[0].visibility).toBe('default');
    response.resolve(ok(undefined));
    await pending;
  });

  it('restores the prior copy visibility after a failed write', async () => {
    const failure = err([{ code: 'HTTP_ERROR', message: 'Write failed' }]);
    const response = Promise.withResolvers<typeof failure>();
    update.mockReturnValue(response.promise);
    const mutation = mountMutation();
    const pending = mutation.mutateAsync({
      eventId: 'event-1',
      calendarId: 'calendar-2',
      patch: { visibility: 'public' },
    });
    await waitFor(() =>
      expect(cached()?.event.sources?.[1].visibility).toBe('public')
    );
    const rejected = expect(pending).rejects.toBeTruthy();
    response.resolve(failure);
    await rejected;
    expect(cached()?.event.sources?.[1].visibility).toBe('private');
    expect(cached()?.event.visibility).toBe('default');
  });
});
