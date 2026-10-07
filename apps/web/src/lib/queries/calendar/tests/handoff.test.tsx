import type { CacheHost, CalendarRangeCacheResult } from '@graphql-cache/index';
import { parseCacheRevision } from '@graphql-cache/protocol';
import type { ListCalendarsResponse } from '@service-calendar/generated/schemas/listCalendarsResponse';
import type { CalendarOccurrenceResponse } from '@service-storage/generated/schemas/calendarOccurrenceResponse';
import type { CalendarFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { type Ok, ok } from 'neverthrow';
import { type Accessor, batch, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVisibleCalendarsQuery } from '../calendars';
import { mapCalendarOccurrence, mapVisibleCalendar } from '../graphql/map';
import { markCalendarCacheAnswered } from '../graphql/readiness';
import { graphqlOccurrence } from '../graphql/tests/fixtures';
import { calendarKeys } from '../keys';
import {
  type CalendarOccurrencesQueryInput,
  useCalendarOccurrencesQuery,
} from '../occurrences';

const mocks = vi.hoisted(() => ({
  listOccurrences: vi.fn(),
  listCalendars: vi.fn(),
  graphqlQuery: vi.fn(),
}));

let cacheHost: Accessor<CacheHost | undefined>;
let client: QueryClient;
let dispose: (() => void) | undefined;

vi.mock('../graphql/flag', () => ({
  useGraphqlCalendarHost: () => () => cacheHost(),
  markCalendarCacheUnsupported: vi.fn(),
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { listCalendarOccurrences: mocks.listOccurrences },
}));
vi.mock('@service-email/client', () => ({
  emailClient: { listCalendars: mocks.listCalendars },
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => ({ query: mocks.graphqlQuery }),
}));
vi.mock('../../client', () => ({
  get queryClient() {
    return client;
  },
}));

const range = {
  start: '2026-10-05T00:00:00.000Z',
  end: '2026-10-12T00:00:00.000Z',
  startDate: '2026-10-05',
  endDate: '2026-10-12',
};
const nextRange = {
  start: '2026-10-12T00:00:00.000Z',
  end: '2026-10-19T00:00:00.000Z',
  startDate: '2026-10-12',
  endDate: '2026-10-19',
};
const initialData = {
  items: [mapCalendarOccurrence(graphqlOccurrence())],
  syncStatus: 'ready' as const,
};
const updatedOccurrence = graphqlOccurrence({ overrideTitle: 'Updated' });
const updatedData = {
  items: [mapCalendarOccurrence(updatedOccurrence)],
  syncStatus: 'ready' as const,
};
const calendar: CalendarFieldsFragment = {
  __typename: 'GraphqlCalendar',
  id: 'calendar-1',
  linkId: 'link-1',
  emailAddress: 'me@example.com',
  name: 'Work',
  color: '#ff0000',
  isPrimary: true,
  isWritable: true,
  isSubscription: false,
  syncError: null,
  defaultReminders: [],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makeHost() {
  const read = deferred<CalendarRangeCacheResult>();
  const calendarRange = vi.fn(() => read.promise);
  const host = {
    calendarRange,
    onCacheChanged: () => () => {},
    readRecordsByKeys: async () => ({
      revision: '1',
      records: [
        {
          recordKey: `GraphqlCalendarOccurrence:${updatedOccurrence.id}`,
          record: updatedOccurrence,
        },
      ],
    }),
  } as unknown as CacheHost;
  markCalendarCacheAnswered(host);
  return {
    host,
    calendarRange,
    finish: () =>
      read.resolve({
        kind: 'range',
        revision: parseCacheRevision('1'),
        occurrenceKeys: [`GraphqlCalendarOccurrence:${updatedOccurrence.id}`],
        gaps: [],
        freshness: 'fresh',
        uncertainEventKeys: [],
        optimistic: false,
        watermark: null,
      }),
  };
}

function renderHook<T>(factory: () => T): T {
  let hook!: T;
  const Harness = () => {
    hook = factory();
    return null;
  };
  dispose = render(
    () => (
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>
    ),
    document.body
  );
  return hook;
}

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  client.clear();
});

describe('calendar query transport handoff', () => {
  it.each(['REST', 'GraphQL'] as const)(
    'retains the same viewport while switching from %s and fetches its replacement',
    async (from) => {
      const cached = makeHost();
      const [host, setHost] = createSignal<CacheHost | undefined>(
        from === 'GraphQL' ? cached.host : undefined
      );
      cacheHost = host;
      const keys = calendarKeys.occurrences('user-1', range);
      client.setQueryData(
        from === 'GraphQL' ? keys._ctx.graphql.queryKey : keys.queryKey,
        initialData
      );
      const rest = deferred<Ok<CalendarOccurrenceResponse, never>>();
      mocks.listOccurrences.mockReturnValue(rest.promise);
      const query = renderHook(() =>
        useCalendarOccurrencesQuery(() => ({ userId: 'user-1', range }))
      );
      await vi.waitFor(() => expect(query.data).toEqual(initialData));

      setHost(from === 'REST' ? cached.host : undefined);

      await vi.waitFor(() => {
        expect(
          from === 'REST' ? cached.calendarRange : mocks.listOccurrences
        ).toHaveBeenCalledOnce();
        expect(query.isSuccess).toBe(true);
        expect(query.data).toEqual(initialData);
      });
      if (from === 'REST') cached.finish();
      else
        rest.resolve(ok({ ...updatedData, hasMore: false, nextCursor: null }));
      await vi.waitFor(() => expect(query.data).toEqual(updatedData));
    }
  );

  it.each(['date', 'user'] as const)(
    'withholds the previous viewport when the %s changes during a transport switch',
    async (change) => {
      const cached = makeHost();
      const [host, setHost] = createSignal<CacheHost>();
      cacheHost = host;
      const [input, setInput] = createSignal<CalendarOccurrencesQueryInput>({
        userId: 'user-1',
        range,
      });
      client.setQueryData(
        calendarKeys.occurrences('user-1', range).queryKey,
        initialData
      );
      const query = renderHook(() => useCalendarOccurrencesQuery(input));
      await vi.waitFor(() => expect(query.data).toEqual(initialData));

      batch(() => {
        setHost(cached.host);
        setInput({
          userId: change === 'user' ? 'user-2' : 'user-1',
          range: change === 'date' ? nextRange : range,
        });
      });

      await vi.waitFor(() => {
        expect(cached.calendarRange).toHaveBeenCalledOnce();
        expect(query.isPending).toBe(true);
        expect(query.data).toBeUndefined();
      });
    }
  );

  it.each(['REST', 'GraphQL'] as const)(
    'keeps calendar names and colors while switching from %s',
    async (from) => {
      const cached = makeHost();
      const [host, setHost] = createSignal<CacheHost | undefined>(
        from === 'GraphQL' ? cached.host : undefined
      );
      cacheHost = host;
      const keys = calendarKeys.visibleCalendars;
      const calendars = [mapVisibleCalendar(calendar)];
      client.setQueryData(
        from === 'GraphQL' ? keys._ctx.graphql.queryKey : keys.queryKey,
        calendars
      );
      const replacement = { ...calendar, name: 'Renamed', color: '#00ff00' };
      const graphql = deferred<{
        data: { user: { calendars: CalendarFieldsFragment[] } };
      }>();
      mocks.graphqlQuery.mockReturnValue({ toPromise: () => graphql.promise });
      const rest = deferred<Ok<ListCalendarsResponse, never>>();
      mocks.listCalendars.mockReturnValue(rest.promise);
      const query = renderHook(useVisibleCalendarsQuery);
      await vi.waitFor(() => expect(query.data).toEqual(calendars));

      setHost(from === 'REST' ? cached.host : undefined);

      await vi.waitFor(() => {
        expect(
          from === 'REST' ? mocks.graphqlQuery : mocks.listCalendars
        ).toHaveBeenCalledOnce();
        expect(query.isSuccess).toBe(true);
        expect(query.data).toEqual(calendars);
      });
      if (from === 'REST') {
        graphql.resolve({ data: { user: { calendars: [replacement] } } });
      } else {
        rest.resolve(ok({ calendars: [mapVisibleCalendar(replacement)] }));
      }
      await vi.waitFor(() =>
        expect(query.data).toEqual([mapVisibleCalendar(replacement)])
      );
    }
  );
});
