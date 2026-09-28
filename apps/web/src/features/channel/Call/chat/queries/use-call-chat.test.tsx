/** @vitest-environment jsdom */
import { ThrownResultError } from '@core/util/result';
import type { MessageThread } from '@service-storage/messages';
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCallChat } from './use-call-chat';

let client: QueryClient;
const mocks = vi.hoisted(() => ({ thread: vi.fn() }));
vi.mock('@service-storage/messages', () => ({ entityMessagesClient: mocks }));
vi.mock('@queries/messages/subscription', () => ({
  useMessageSubscription: () => {},
}));
vi.mock('@queries/client', () => ({
  get queryClient() {
    return client;
  },
}));

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mocks.thread.mockReset();
});
afterEach(() => {
  cleanup();
  client.clear();
});

function mount() {
  let source!: ReturnType<typeof useCallChat>;
  render(() => (
    <QueryClientProvider client={client}>
      {(() => {
        source = useCallChat(() => 'call-id');
        return null;
      })()}
    </QueryClientProvider>
  ));
  return source;
}

function failure(code: string) {
  return new ThrownResultError([{ code, message: code }]);
}

const thread: MessageThread = {
  root: {
    id: 'call-id',
    parent: { type: 'call', id: 'call-id' },
    sender_id: 'user',
    content: 'First message',
    mentions: [],
    attachments: [],
    reactions: [],
    created_at: '2026-09-26T00:00:00Z',
    updated_at: '2026-09-26T00:00:00Z',
  },
  state: {
    root_id: 'call-id',
    user_id: 'user',
    resolved: false,
    created_at: '2026-09-26T00:00:00Z',
    updated_at: '2026-09-26T00:00:00Z',
  },
  replies: [],
};

it('treats only a missing root as an empty conversation and can refresh after the first send', async () => {
  mocks.thread.mockRejectedValueOnce(failure('NOT_FOUND'));
  const source = mount();
  expect(source.loading()).toBe(true);
  expect(source.thread()).toBeUndefined();
  await waitFor(() => expect(source.empty()).toBe(true));
  expect(source.failed()).toBe(false);
  expect(mocks.thread).toHaveBeenCalledOnce();
  expect(mocks.thread).toHaveBeenCalledWith(
    { type: 'call', id: 'call-id' },
    'call-id'
  );
  mocks.thread.mockResolvedValue(thread);
  await source.refresh();
  await waitFor(() =>
    expect(source.thread()?.root.content).toBe('First message')
  );
  expect(source.empty()).toBe(false);
});

it.each(['FORBIDDEN', 'UNAUTHORIZED', 'INTERNAL_SERVER_ERROR'])(
  'keeps %s failures distinct from an empty chat',
  async (code) => {
    mocks.thread.mockRejectedValue(failure(code));
    const source = mount();
    await waitFor(() => expect(source.failed()).toBe(true));
    expect(source.empty()).toBe(false);
    expect(source.thread()).toBeUndefined();
  }
);

it('retains readable messages through a failed background refresh', async () => {
  mocks.thread.mockResolvedValueOnce(thread);
  const source = mount();
  await waitFor(() => expect(source.thread()).toBeDefined());
  mocks.thread.mockRejectedValue(failure('INTERNAL_SERVER_ERROR'));
  await source.refresh();
  await waitFor(() => expect(source.failed()).toBe(true));
  expect(source.thread()?.root.content).toBe('First message');
});
