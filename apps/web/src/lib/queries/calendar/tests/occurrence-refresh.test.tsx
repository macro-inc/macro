import type { CalendarOccurrenceResponse } from '@service-storage/generated/schemas/calendarOccurrenceResponse';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok, type Result } from 'neverthrow';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { calendarKeys } from '../keys';
import {
  type CalendarOccurrencesData,
  useCalendarOccurrencesQuery,
} from '../occurrences';

const read = vi.hoisted(() => vi.fn());
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { listCalendarOccurrences: read },
}));
vi.mock('../graphql/flag', () => ({
  useGraphqlCalendarHost: () => () => undefined,
  markCalendarCacheUnsupported: vi.fn(),
}));

const RANGE = {
  start: '2026-11-09T00:00:00Z',
  end: '2026-11-16T00:00:00Z',
  startDate: '2026-11-09',
  endDate: '2026-11-16',
};
const DATA: CalendarOccurrencesData = { items: [], syncStatus: 'ready' };
let client: QueryClient;
let dispose: (() => void) | undefined;
beforeEach(() => {
  read.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(calendarKeys.occurrences('viewer', RANGE).queryKey, DATA);
});
afterEach(() => {
  dispose?.();
  client.clear();
});

function mount(phases: string[]) {
  let query!: ReturnType<typeof useCalendarOccurrencesQuery>;
  dispose = render(
    () => (
      <QueryClientProvider client={client}>
        {(() => {
          query = useCalendarOccurrencesQuery(
            () => ({ userId: 'viewer', range: RANGE }),
            () => ({ onRefresh: (phase) => phases.push(phase) })
          );
          return null;
        })()}
      </QueryClientProvider>
    ),
    document.body
  );
  return query;
}

it('reports real read lifecycles but not optimistic cache writes or unrelated ranges', async () => {
  const phases: string[] = [];
  const query = mount(phases);
  client.setQueryData(calendarKeys.occurrences('viewer', RANGE).queryKey, {
    ...DATA,
  });
  client.setQueryData(
    calendarKeys.occurrences('another-viewer', RANGE).queryKey,
    DATA
  );
  expect(phases).toEqual([]);
  const started = Promise.withResolvers<void>();
  const response =
    Promise.withResolvers<Result<CalendarOccurrenceResponse, unknown>>();
  read.mockImplementation(() => {
    started.resolve();
    return response.promise;
  });
  const refreshing = query.refetch();
  await started.promise;
  expect(phases).toEqual(['started']);
  response.resolve(ok({ ...DATA, hasMore: false }));
  await refreshing;
  expect(phases).toEqual(['started', 'completed']);
});

it('does not mark a failed refresh complete, then reports a successful retry', async () => {
  const phases: string[] = [];
  const query = mount(phases);
  read.mockResolvedValueOnce(
    err([{ code: 'HTTP_ERROR', message: 'Read failed' }])
  );
  await query.refetch();
  expect(phases).toEqual(['started']);
  read.mockResolvedValueOnce(ok({ ...DATA, hasMore: false }));
  await query.refetch();
  expect(phases).toEqual(['started', 'started', 'completed']);
});

it('identifies a replacement read when an in-flight refresh is cancelled', async () => {
  const phases: string[] = [];
  const query = mount(phases);
  const firstStarted = Promise.withResolvers<void>();
  const secondStarted = Promise.withResolvers<void>();
  const firstResponse =
    Promise.withResolvers<Result<CalendarOccurrenceResponse, unknown>>();
  const secondResponse =
    Promise.withResolvers<Result<CalendarOccurrenceResponse, unknown>>();
  read.mockImplementationOnce(() => {
    firstStarted.resolve();
    return firstResponse.promise;
  });
  read.mockImplementationOnce(() => {
    secondStarted.resolve();
    return secondResponse.promise;
  });
  const first = query.refetch();
  await firstStarted.promise;
  const second = query.refetch();
  await secondStarted.promise;
  expect(phases).toEqual(['started', 'started']);
  secondResponse.resolve(ok({ ...DATA, hasMore: false }));
  await second;
  firstResponse.resolve(ok({ ...DATA, hasMore: false }));
  await first;
  expect(phases).toEqual(['started', 'started', 'completed']);
});
