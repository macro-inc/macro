import {
  focusManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchTeamOutOfOffice, useTeamOutOfOfficeQueries } from '../team-ooo';

const listTeamOutOfOffice = vi.hoisted(() => vi.fn());

vi.mock('@service-storage/client', () => ({
  storageServiceClient: { listTeamOutOfOffice },
}));
vi.mock('../team', () => ({
  useCalendarTeamIdentityQuery: () => ({
    isSuccess: true,
    isPaused: false,
    data: { team: { id: 'team-a' }, members: [{ user_id: 'alice' }] },
  }),
}));

let testQueryClient: QueryClient;

vi.mock('../../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));

const window = {
  start: '2026-09-28T04:00:00.000Z',
  end: '2026-12-28T05:00:00.000Z',
  startDate: '2026-09-28',
  endDate: '2026-12-28',
};

const disposers: (() => void)[] = [];

function renderObserver() {
  disposers.push(
    render(
      () => (
        <QueryClientProvider client={testQueryClient}>
          {(() => {
            useTeamOutOfOfficeQueries(() => ({
              userId: 'alice',
              ranges: [window],
            }));
            return null as unknown as JSX.Element;
          })()}
        </QueryClientProvider>
      ),
      document.body
    )
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  focusManager.setFocused(true);
  listTeamOutOfOffice.mockResolvedValue(ok({ items: [] }));
  testQueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
});

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  focusManager.setFocused(undefined);
  vi.useRealTimers();
});

describe('useTeamOutOfOfficeQueries', () => {
  it('polls a window once per interval however many views observe it', async () => {
    // Views mount at different times, as the calendar's pages and its
    // sidebar do; per-observer intervals would each poll on their own clock.
    renderObserver();
    await vi.advanceTimersByTimeAsync(10_000);
    renderObserver();
    await vi.advanceTimersByTimeAsync(10_000);
    renderObserver();
    await vi.advanceTimersByTimeAsync(0);
    const mounted = listTeamOutOfOffice.mock.calls.length;

    await vi.advanceTimersByTimeAsync(10_000);
    expect(listTeamOutOfOffice).toHaveBeenCalledTimes(mounted + 1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(listTeamOutOfOffice).toHaveBeenCalledTimes(mounted + 2);

    focusManager.setFocused(false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(listTeamOutOfOffice).toHaveBeenCalledTimes(mounted + 2);
  });
});

describe('fetchTeamOutOfOffice', () => {
  it('splits a window with more than one page until each part fits', async () => {
    const item = (eventId: string, startDate: string, endDate: string) => ({
      eventId,
      occurrenceKey: startDate,
      ownerId: 'bob',
      time: { kind: 'allDay' as const, startDate, endDate },
    });
    listTeamOutOfOffice.mockImplementationOnce(async () =>
      ok({ hasMore: true, items: [] })
    );
    listTeamOutOfOffice.mockImplementationOnce(async () =>
      ok({
        hasMore: false,
        items: [
          item('early', '2026-10-01', '2026-10-02'),
          item('spanning', '2026-11-10', '2026-11-14'),
        ],
      })
    );
    listTeamOutOfOffice.mockImplementationOnce(async () =>
      ok({
        hasMore: false,
        items: [
          item('spanning', '2026-11-10', '2026-11-14'),
          item('late', '2026-12-20', '2026-12-21'),
        ],
      })
    );

    const items = await fetchTeamOutOfOffice(window);

    expect(
      listTeamOutOfOffice.mock.calls.map(([args]) => [
        args.startDate,
        args.endDate,
      ])
    ).toEqual([
      ['2026-09-28', '2026-12-28'],
      ['2026-09-28', '2026-11-12'],
      ['2026-11-12', '2026-12-28'],
    ]);
    expect(items.map((found) => found.eventId)).toEqual([
      'early',
      'spanning',
      'late',
    ]);
  });
});
