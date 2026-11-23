/** @vitest-environment jsdom */
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useGuestCallThread } from './use-guest-call-thread';

let client: QueryClient;
const mocks = vi.hoisted(() => ({
  getGuestChatThread: vi.fn(),
  postGuestChatMessage: vi.fn(),
  patchGuestChatMessage: vi.fn(),
  deleteGuestChatMessage: vi.fn(),
  reactGuestChatMessage: vi.fn(),
}));
vi.mock('@service-call/client', () => ({ callServiceClient: mocks }));
vi.mock('@queries/client', () => ({
  get queryClient() {
    return client;
  },
}));
const thread = {
  state: { type: 'open' },
  root: {
    id: 'call',
    parent: { type: 'call', id: 'call' },
    sender_id: 'guest-id',
    content: 'Hello',
  },
  replies: [],
};

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.resetAllMocks();
  mocks.getGuestChatThread.mockResolvedValue(
    ok({ viewer_id: 'guest-id', thread })
  );
  mocks.postGuestChatMessage.mockResolvedValue(ok(thread.root));
  mocks.patchGuestChatMessage.mockResolvedValue(ok(thread.root));
  mocks.deleteGuestChatMessage.mockResolvedValue(ok(undefined));
  mocks.reactGuestChatMessage.mockResolvedValue(ok(thread.root));
});
afterEach(() => {
  cleanup();
  client.clear();
});

function mount(initialOpen = true) {
  let source!: ReturnType<typeof useGuestCallThread>;
  const [open, setOpen] = createSignal(initialOpen);
  function Harness() {
    source = useGuestCallThread(
      () => 'call',
      () => ({ token: 'secret', participantId: 'participant' }),
      open
    );
    return <span>{source.thread()?.root.content ?? 'pending'}</span>;
  }
  const rendered = render(() => (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  ));
  return { source, setOpen, unmount: rendered.unmount };
}

it('fetches only while open and clears token-free cache on unmount', async () => {
  const { source, setOpen, unmount } = mount(false);
  expect(mocks.getGuestChatThread).not.toHaveBeenCalled();
  setOpen(true);
  await waitFor(() => expect(source.thread()).toEqual(thread));
  expect(source.viewerId()).toBe('guest-id');
  expect(mocks.getGuestChatThread).toHaveBeenCalledWith('call', 'secret');
  expect(
    JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey)
    )
  ).not.toContain('secret');
  unmount();
  expect(client.getQueryCache().getAll()).toHaveLength(0);
});

it('hides cached thread after access is denied and can retry', async () => {
  const { source } = mount();
  await waitFor(() => expect(source.thread()).toEqual(thread));
  mocks.getGuestChatThread.mockResolvedValueOnce(
    err([{ code: 'FORBIDDEN', message: 'Left call' }])
  );
  await source.refresh();
  await waitFor(() => expect(source.denied()).toBe(true));
  expect(source.thread()).toBeUndefined();
  expect(source.viewerId()).toBeUndefined();
  await source.refresh();
  await waitFor(() => expect(source.thread()).toEqual(thread));
});

it('treats a null thread as an empty call', async () => {
  mocks.getGuestChatThread.mockResolvedValue(
    ok({ viewer_id: 'guest-id', thread: null })
  );
  const { source } = mount();
  await waitFor(() => expect(source.empty()).toBe(true));
  expect(source.thread()).toBeUndefined();
  expect(source.viewerId()).toBe('guest-id');
});

it('posts and changes messages through the guest token, then refreshes', async () => {
  const { source } = mount();
  await waitFor(() => expect(source.thread()).toEqual(thread));
  await source.send({ id: 'new-id', content: 'Hi' });
  await source.patch('new-id', 'Edited');
  await source.remove('new-id');
  await source.react('call', '👍', true);
  expect(mocks.postGuestChatMessage).toHaveBeenCalledWith('call', 'secret', {
    id: 'new-id',
    content: 'Hi',
  });
  expect(mocks.patchGuestChatMessage).toHaveBeenCalledWith(
    'call',
    'secret',
    'new-id',
    { content: 'Edited' }
  );
  expect(mocks.deleteGuestChatMessage).toHaveBeenCalledWith(
    'call',
    'secret',
    'new-id'
  );
  expect(mocks.reactGuestChatMessage).toHaveBeenCalledWith(
    'call',
    'secret',
    'call',
    { emoji: '👍', add: true }
  );
  expect(mocks.getGuestChatThread).toHaveBeenCalledTimes(5);
});
