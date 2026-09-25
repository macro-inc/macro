import { type ActiveMeeting, callServiceClient } from '@service-call/client';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { createComponent, createRoot } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useActiveQuickCallsSource } from './active-quick-calls';

vi.mock('@service-call/client', () => ({
  callServiceClient: { getActiveMeetings: vi.fn() },
}));
vi.mock('@queries/client', () => ({
  queryClient: { invalidateQueries: vi.fn() },
}));

const meeting: ActiveMeeting = {
  id: 'live-meeting',
  createdBy: 'macro|maya@example.com',
  title: 'Design catch-up',
  shareToken: 'private-share-token',
  callId: 'live-call',
  channelId: null,
  scheduledStart: null,
  scheduledEnd: null,
};
const list = vi.mocked(callServiceClient.getActiveMeetings);
const disposers: (() => void)[] = [];
let client: QueryClient;

function setup() {
  let source!: ReturnType<typeof useActiveQuickCallsSource>;
  function Harness() {
    source = useActiveQuickCallsSource(() => 'alice');
    return null;
  }
  const dispose = createRoot((dispose) => {
    createComponent(QueryClientProvider, {
      client,
      get children() {
        return createComponent(Harness, {});
      },
    });
    return dispose;
  });
  disposers.push(dispose);
  return source;
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  list.mockReset();
  list.mockResolvedValue(ok([meeting]));
});

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  client.clear();
  vi.useRealTimers();
});

it('removes ended calls on the next active-session poll', async () => {
  vi.useFakeTimers();
  const source = setup();
  await vi.waitFor(() => expect(source.calls()).toHaveLength(1));
  list.mockResolvedValue(ok([]));
  await vi.advanceTimersByTimeAsync(15_000);
  expect(list).toHaveBeenCalledTimes(2);
  expect(source.calls()).toEqual([]);
});

it('retains live calls on a failed background refresh and clears its error after retry', async () => {
  const source = setup();
  await vi.waitFor(() => expect(source.calls()).toHaveLength(1));
  expect(source.calls()[0]).toEqual({
    id: meeting.id,
    createdBy: meeting.createdBy,
    title: meeting.title,
    url: `${window.location.origin}/app/meet/join/${meeting.shareToken}`,
  });
  list.mockResolvedValue(
    err([{ code: 'SERVER_ERROR', message: 'Unavailable' }])
  );
  source.refresh();
  await vi.waitFor(() => expect(source.error()).toBeDefined());
  expect(source.calls()).toHaveLength(1);
  list.mockResolvedValue(ok([]));
  source.refresh();
  await vi.waitFor(() => expect(source.error()).toBeUndefined());
  expect(source.calls()).toEqual([]);
});

it.each(['UNAUTHORIZED', 'FORBIDDEN'] as const)(
  'hides retained live calls after an %s response',
  async (code) => {
    const source = setup();
    await vi.waitFor(() => expect(source.calls()).toHaveLength(1));
    list.mockResolvedValue(err([{ code, message: 'No access' }]));
    source.refresh();
    await vi.waitFor(() => expect(source.error()).toBeDefined());
    expect(source.calls()).toEqual([]);
  }
);
