/** @vitest-environment jsdom */
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useGuestCallChat } from './use-guest-call-chat';

let client: QueryClient;
const mocks = vi.hoisted(() => ({
  getGuestChat: vi.fn(),
  postGuestChat: vi.fn(),
}));
vi.mock('@service-call/client', () => ({ callServiceClient: mocks }));
vi.mock('@queries/client', () => ({
  get queryClient() {
    return client;
  },
}));
const message = {
  id: 'message',
  name: 'Visitor',
  guest: true,
  is_you: true,
  content: 'Hello',
  created_at: '2026-10-01T00:00:00Z',
};
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.resetAllMocks();
  mocks.getGuestChat.mockResolvedValue(ok({ messages: [message] }));
  mocks.postGuestChat.mockResolvedValue(ok(message));
});
afterEach(() => {
  cleanup();
  client.clear();
});

function mount(initialOpen = true) {
  let source!: ReturnType<typeof useGuestCallChat>;
  const [open, setOpen] = createSignal(initialOpen);
  function Harness() {
    source = useGuestCallChat(
      () => 'call',
      () => ({ token: 'secret', participantId: 'guest' }),
      open
    );
    return <span>{source.ready() ? source.messages().length : 'pending'}</span>;
  }
  const rendered = render(() => (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  ));
  return { source, setOpen, unmount: rendered.unmount };
}

it('fetches only when open, keeps tokens out of cache keys, and clears session history on unmount', async () => {
  const { source, setOpen, unmount } = mount(false);
  await waitFor(() => expect(source.loading()).toBe(true));
  expect(mocks.getGuestChat).not.toHaveBeenCalled();
  setOpen(true);
  await waitFor(() => expect(source.ready()).toBe(true));
  expect(mocks.getGuestChat).toHaveBeenCalledWith('call', 'secret');
  expect(
    JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey)
    )
  ).not.toContain('secret');
  expect(source.messages()).toEqual([message]);
  unmount();
  expect(client.getQueryCache().getAll()).toHaveLength(0);
});

it('hides cached messages and disables sending after access is revoked', async () => {
  const { source, setOpen } = mount();
  setOpen(true);
  await waitFor(() => expect(source.ready()).toBe(true));
  mocks.getGuestChat.mockResolvedValue(
    err([{ code: 'FORBIDDEN', message: 'Guest left' }])
  );
  await source.refresh();
  await waitFor(() => expect(source.denied()).toBe(true));
  expect(source.messages()).toEqual([]);
  expect(source.ready()).toBe(false);
});

it('deduplicates sent messages in the cache and preserves history on transient refresh failures', async () => {
  const { source, setOpen } = mount();
  setOpen(true);
  await waitFor(() => expect(source.ready()).toBe(true));
  await source.send({ id: 'client-id', content: 'Hello' });
  expect(source.messages()).toHaveLength(1);
  mocks.getGuestChat.mockResolvedValue(
    err([{ code: 'SERVER_ERROR', message: 'Unavailable' }])
  );
  await source.refresh();
  await waitFor(() => expect(source.failed()).toBe(true));
  expect(source.ready()).toBe(true);
  expect(source.messages()).toEqual([message]);
});
