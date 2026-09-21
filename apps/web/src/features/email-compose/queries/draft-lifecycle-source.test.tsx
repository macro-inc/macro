import { emailKeys } from '@queries/email/keys';
import type { ApiThread } from '@service-email/generated/schemas';
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  EmailDraftLifecycleSource,
  EmailDraftLifecycleState,
} from '../context/compose-capabilities';

const fetchThread = vi.hoisted(() => vi.fn());
vi.mock('@queries/email/thread', () => ({
  fetchFreshEmailThread: fetchThread,
}));
vi.mock('@core/cross-tab/cross-tab-bus', () => ({
  createCrossTabBus: () => ({ publish() {}, subscribe: () => () => {} }),
}));

import { emailDraftLifecycleSource } from './draft-lifecycle';

const identity = { draftId: 'draft', threadId: 'thread', inboxId: 'inbox' };
const queryKey = emailKeys.composeDraftState(identity).queryKey;
const clients: QueryClient[] = [];

function thread(scheduled: boolean): ApiThread {
  return {
    access_level: 'owner',
    created_at: '2026-09-21T00:00:00Z',
    updated_at: '2026-09-21T00:00:00Z',
    db_id: 'thread',
    link_id: 'inbox',
    inbox_visible: false,
    is_read: true,
    messages: [
      {
        attachments: [],
        attachments_draft: [],
        attachments_forwarded: [],
        to: [],
        cc: [],
        bcc: [],
        labels: [],
        created_at: '2026-09-21T00:00:00Z',
        updated_at: '2026-09-21T00:00:00Z',
        db_id: 'draft',
        thread_db_id: 'thread',
        link_id: 'inbox',
        has_attachments: false,
        is_draft: true,
        is_sent: false,
        is_read: true,
        is_starred: false,
        scheduled_send_time: scheduled ? '2026-12-01T12:00:00Z' : null,
      },
    ],
  };
}

function createClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(client);
  return client;
}

function observe(client = createClient()) {
  const [current, setCurrent] = createSignal(identity);
  let lifecycle!: ReturnType<EmailDraftLifecycleSource['observe']>;
  function Probe() {
    lifecycle = emailDraftLifecycleSource.observe({
      draftId: () => current().draftId,
      threadId: () => current().threadId,
      inboxId: () => current().inboxId,
    });
    return null;
  }
  const { unmount } = render(() => (
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>
  ));
  return { lifecycle, client, setCurrent, unmount };
}

beforeEach(() => fetchThread.mockReset());
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
});

it.each([true, false])(
  'starts an independent read after a schedule change (scheduled: %s)',
  async (scheduled) => {
    const oldRead = Promise.withResolvers<ApiThread>();
    const freshRead = Promise.withResolvers<ApiThread>();
    fetchThread
      .mockReturnValueOnce(oldRead.promise)
      .mockReturnValueOnce(freshRead.promise);
    const { lifecycle, client } = observe();
    await waitFor(() => expect(fetchThread).toHaveBeenCalledOnce());

    const refreshing = lifecycle.refresh();
    // A hung initial read must not hold the authoritative read hostage.
    await waitFor(() => expect(fetchThread).toHaveBeenCalledTimes(2));
    expect(lifecycle.state()).toBeUndefined();
    freshRead.resolve(thread(scheduled));
    await refreshing;
    const expected = scheduled ? 'scheduled' : 'editing';
    await waitFor(() => expect(lifecycle.state()?.type).toBe(expected));
    oldRead.resolve(thread(!scheduled));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(lifecycle.state()?.type).toBe(expected);
    expect(
      client
        .getQueriesData<EmailDraftLifecycleState>({ queryKey })
        .map(([, state]) => state?.type)
    ).toEqual([expected]);
  }
);

it('ignores a cached sent state while a remounted draft awaits its fresh read', async () => {
  const sent = thread(false);
  sent.messages[0].is_sent = true;
  const freshRead = Promise.withResolvers<ApiThread>();
  fetchThread
    .mockResolvedValueOnce(sent)
    .mockReturnValueOnce(freshRead.promise);
  const previous = observe();
  await waitFor(() => expect(previous.lifecycle.state()?.type).toBe('sent'));
  previous.unmount();
  const { lifecycle } = observe(previous.client);
  await waitFor(() => expect(fetchThread).toHaveBeenCalledTimes(2));
  expect(lifecycle.state()).toBeUndefined();
  freshRead.resolve(thread(false));
  await waitFor(() => expect(lifecycle.state()?.type).toBe('editing'));
});

it('keeps simultaneous observers from cancelling each other or replaying cached editing', async () => {
  const firstRead = Promise.withResolvers<ApiThread>();
  const secondRead = Promise.withResolvers<ApiThread>();
  fetchThread
    .mockResolvedValueOnce(thread(false))
    .mockResolvedValueOnce(thread(false))
    .mockReturnValueOnce(firstRead.promise)
    .mockReturnValueOnce(secondRead.promise);
  const first = observe();
  await waitFor(() => expect(first.lifecycle.state()?.type).toBe('editing'));
  const second = observe(first.client);
  await waitFor(() => expect(second.lifecycle.state()?.type).toBe('editing'));

  let firstFinished = false;
  async function refreshFirst() {
    const state = await first.lifecycle.refresh();
    firstFinished = true;
    return state;
  }
  const firstRefresh = refreshFirst();
  await waitFor(() => expect(fetchThread).toHaveBeenCalledTimes(3));
  const secondRefresh = second.lifecycle.refresh();
  await waitFor(() => expect(fetchThread).toHaveBeenCalledTimes(4));
  expect(firstFinished).toBe(false);
  expect(first.lifecycle.state()).toBeUndefined();
  expect(second.lifecycle.state()).toBeUndefined();

  secondRead.resolve(thread(true));
  expect((await secondRefresh)?.type).toBe('scheduled');
  await waitFor(() => expect(second.lifecycle.state()?.type).toBe('scheduled'));
  expect(firstFinished).toBe(false);
  expect(first.lifecycle.state()).toBeUndefined();

  firstRead.resolve(thread(true));
  expect((await firstRefresh)?.type).toBe('scheduled');
  await waitFor(() => expect(first.lifecycle.state()?.type).toBe('scheduled'));
});

it.each(['scheduled', 'sent'] as const)(
  'does not reuse a pending %s read from a previous mount',
  async (oldState) => {
    const oldRead = Promise.withResolvers<ApiThread>();
    const freshRead = Promise.withResolvers<ApiThread>();
    fetchThread
      .mockReturnValueOnce(oldRead.promise)
      .mockReturnValueOnce(freshRead.promise);
    const previous = observe();
    await waitFor(() => expect(fetchThread).toHaveBeenCalledOnce());
    previous.unmount();

    const { lifecycle } = observe(previous.client);
    await waitFor(() => expect(fetchThread).toHaveBeenCalledTimes(2));
    expect(lifecycle.state()).toBeUndefined();
    freshRead.resolve(thread(false));
    await waitFor(() => expect(lifecycle.state()?.type).toBe('editing'));

    const staleThread = thread(oldState === 'scheduled');
    staleThread.messages[0].is_sent = oldState === 'sent';
    oldRead.resolve(staleThread);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(lifecycle.state()?.type).toBe('editing');
  }
);

it('refetches every scoped observer through the websocket lifecycle prefix', async () => {
  fetchThread.mockResolvedValue(thread(false));
  const first = observe();
  await waitFor(() => expect(first.lifecycle.state()?.type).toBe('editing'));
  const second = observe(first.client);
  await waitFor(() => expect(second.lifecycle.state()?.type).toBe('editing'));
  expect(fetchThread).toHaveBeenCalledTimes(2);
  const queries = first.client.getQueryCache().findAll({ queryKey });
  expect(queries).toHaveLength(2);
  for (const query of queries) {
    expect(query.queryKey.slice(0, -1)).toEqual(queryKey);
  }

  fetchThread.mockResolvedValue(thread(true));
  await first.client.invalidateQueries({
    queryKey: emailKeys.composeDraftState._def,
  });
  expect(fetchThread).toHaveBeenCalledTimes(4);
  await waitFor(() => {
    expect(first.lifecycle.state()?.type).toBe('scheduled');
    expect(second.lifecycle.state()?.type).toBe('scheduled');
  });
});

it('does not let an old identity refresh hide the migrated draft', async () => {
  const initial = Promise.withResolvers<ApiThread>();
  const refreshingOldIdentity = Promise.withResolvers<ApiThread>();
  const movedIdentity = {
    draftId: 'moved',
    threadId: 'moved-thread',
    inboxId: 'other',
  };
  const movedThread = thread(false);
  movedThread.db_id = movedIdentity.threadId;
  movedThread.link_id = movedIdentity.inboxId;
  movedThread.messages = movedThread.messages.map((message) => ({
    ...message,
    db_id: movedIdentity.draftId,
    thread_db_id: movedIdentity.threadId,
    link_id: movedIdentity.inboxId,
  }));
  fetchThread
    .mockReturnValueOnce(initial.promise)
    .mockReturnValueOnce(refreshingOldIdentity.promise)
    .mockResolvedValueOnce(movedThread);
  const { lifecycle, setCurrent } = observe();
  await waitFor(() => expect(fetchThread).toHaveBeenCalledOnce());
  const refreshing = lifecycle.refresh();
  await waitFor(() => expect(fetchThread).toHaveBeenCalledTimes(2));
  setCurrent(movedIdentity);
  await waitFor(() =>
    expect(lifecycle.state()).toMatchObject({
      ...movedIdentity,
      type: 'editing',
    })
  );
  initial.resolve(thread(true));
  refreshingOldIdentity.resolve(thread(true));
  expect(await refreshing).toBeUndefined();
  expect(lifecycle.state()).toMatchObject({
    ...movedIdentity,
    type: 'editing',
  });
});
