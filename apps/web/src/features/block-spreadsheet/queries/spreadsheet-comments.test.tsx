import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  messages: {
    list: vi.fn(),
    thread: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  event: undefined as
    | undefined
    | ((event: { type: string; data: string }) => void),
}));
vi.mock('@service-storage/messages', () => ({
  entityMessagesClient: mocks.messages,
}));
vi.mock('@service-connection/websocket', () => ({
  state: () => 1,
  createConnectionWebsocketEffect: (fn: typeof mocks.event) => {
    mocks.event = fn;
  },
}));

import {
  spreadsheetCommentsApi,
  useSpreadsheetComments,
} from './spreadsheet-comments';

const parent = { type: 'document', id: 'sheet-document' };
const message = (id: string, thread_id: string | null = null) => ({
  id,
  parent,
  thread_id,
  sender_id: 'me',
  content: id,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  mentions: [],
  attachments: [],
  reactions: [],
});
const thread = (rootId: string, deleted_at: string | null = null) => ({
  state: {
    root_id: rootId,
    user_id: 'me',
    resolved: false,
    anchor: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    deleted_at,
  },
  root: message(rootId),
  replies: [message(`${rootId}-reply`, rootId)],
});
const listItem = (rootId: string, deleted_at: string | null = null) => ({
  ...message(rootId),
  state: thread(rootId, deleted_at).state,
  thread: { reply_count: 1, preview: [], latest_reply_at: null },
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it('lists every live thread with all replies and writes through the message routes', async () => {
  const api = spreadsheetCommentsApi('sheet-document');
  mocks.messages.list
    .mockResolvedValueOnce({
      items: [listItem('root-1'), listItem('gone', 'yesterday')],
      next_cursor: { id: 'root-1', created_at: '2026-01-01T00:00:00Z' },
    })
    .mockResolvedValueOnce({ items: [listItem('root-2')], next_cursor: null });
  mocks.messages.thread.mockImplementation(async (_parent, id: string) =>
    thread(id)
  );
  mocks.messages.post.mockResolvedValue(message('root-3'));
  mocks.messages.patch.mockResolvedValue(message('root-1'));
  mocks.messages.delete.mockResolvedValue(message('root-1'));

  const listed = await api.list();
  expect(listed.map((item) => item.state.root_id)).toEqual([
    'root-1',
    'root-2',
  ]);
  expect(listed[0].replies.map((reply) => reply.id)).toEqual(['root-1-reply']);
  expect(mocks.messages.list).toHaveBeenNthCalledWith(1, parent, {
    limit: 100,
    cursor: undefined,
  });
  expect(mocks.messages.list).toHaveBeenNthCalledWith(2, parent, {
    limit: 100,
    cursor: { id: 'root-1', created_at: '2026-01-01T00:00:00Z' },
  });
  expect(mocks.messages.thread).not.toHaveBeenCalledWith(parent, 'gone');

  const body = { content: 'Hello', thread_id: 'root-1', mentions: [] };
  await api.create(body);
  await api.edit('root-1', 'Updated', []);
  await api.delete('root-1');
  expect(mocks.messages.post).toHaveBeenCalledWith(parent, body);
  expect(mocks.messages.patch).toHaveBeenCalledWith(parent, 'root-1', {
    content: 'Updated',
    mentions: [],
  });
  expect(mocks.messages.delete).toHaveBeenCalledWith(parent, 'root-1');
});
it('surfaces API errors instead of treating them as successful writes', async () => {
  const api = spreadsheetCommentsApi('sheet');
  for (const mock of Object.values(mocks.messages))
    mock.mockRejectedValue(new Error('denied'));
  await expect(api.list()).rejects.toThrow('load comments');
  await expect(api.create({ content: 'draft' })).rejects.toThrow(
    'draft has been kept'
  );
  await expect(api.edit('1', 'draft', [])).rejects.toThrow(
    'draft has been kept'
  );
  await expect(api.delete('1')).rejects.toThrow('delete comment');
});
it('refreshes on live message changes for this document only and tolerates malformed events', async () => {
  mocks.messages.list.mockResolvedValue({ items: [], next_cursor: null });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let state!: ReturnType<typeof useSpreadsheetComments>;
  function Probe() {
    state = useSpreadsheetComments('sheet');
    return null;
  }
  render(() => (
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>
  ));
  await waitFor(() => expect(state.query.isSuccess).toBe(true));
  const send = (
    documentId: string,
    change: Record<string, unknown> = { type: 'posted' }
  ) =>
    mocks.event?.({
      type: 'message_update',
      data: JSON.stringify({
        parent: { type: 'document', id: documentId },
        actor: 'someone',
        nonce: null,
        change,
      }),
    });
  send('other');
  send('sheet', { type: 'typing', thread_id: null, active: true });
  mocks.event?.({ type: 'comment', data: '{}' });
  mocks.event?.({ type: 'message_update', data: 'not json' });
  expect(mocks.messages.list).toHaveBeenCalledTimes(1);
  mocks.messages.list.mockResolvedValue({
    items: [listItem('root-8')],
    next_cursor: null,
  });
  mocks.messages.thread.mockResolvedValue(thread('root-8'));
  send('sheet');
  await waitFor(() =>
    expect(state.query.data?.[0]?.state.root_id).toBe('root-8')
  );
  expect(mocks.messages.list).toHaveBeenCalledTimes(2);
  client.clear();
});
