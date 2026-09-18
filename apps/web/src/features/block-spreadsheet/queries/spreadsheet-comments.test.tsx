import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  annotations: {
    getComments: vi.fn(),
    createComment: vi.fn(),
    editComment: vi.fn(),
    deleteComment: vi.fn(),
  },
  event: undefined as
    | undefined
    | ((event: { type: string; data: string }) => void),
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { annotations: mocks.annotations },
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

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it('uses the existing comment API for list, create, edit, and delete', async () => {
  const api = spreadsheetCommentsApi('sheet-document');
  mocks.annotations.getComments.mockResolvedValue(ok({ data: [] }));
  mocks.annotations.createComment.mockResolvedValue(
    ok({ thread: { threadId: 8 }, comments: [] })
  );
  mocks.annotations.editComment.mockResolvedValue(ok({ commentId: 42 }));
  mocks.annotations.deleteComment.mockResolvedValue(ok({ commentId: 42 }));
  expect(await api.list()).toEqual([]);
  const body = { text: 'Hello', threadId: 8 };
  await api.create(body);
  await api.edit(42, 8, 'Updated');
  await api.delete(42);
  expect(mocks.annotations.getComments).toHaveBeenCalledWith({
    documentId: 'sheet-document',
  });
  expect(mocks.annotations.createComment).toHaveBeenCalledWith({
    documentId: 'sheet-document',
    body,
  });
  expect(mocks.annotations.editComment).toHaveBeenCalledWith({
    commentId: 42,
    body: { text: 'Updated', threadId: 8 },
  });
  expect(mocks.annotations.deleteComment).toHaveBeenCalledWith({
    commentId: 42,
    body: {},
  });
});
it('surfaces API errors instead of treating them as successful writes', async () => {
  const api = spreadsheetCommentsApi('sheet');
  for (const mock of Object.values(mocks.annotations))
    mock.mockResolvedValue(err('denied'));
  await expect(api.list()).rejects.toThrow('load comments');
  await expect(api.create({ text: 'draft' })).rejects.toThrow(
    'draft has been kept'
  );
  await expect(api.edit(1, 2, 'draft')).rejects.toThrow('draft has been kept');
  await expect(api.delete(1)).rejects.toThrow('delete comment');
});
it('refreshes live changes only for this document and tolerates malformed events', async () => {
  mocks.annotations.getComments.mockResolvedValue(ok({ data: [] }));
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
  const send = (documentId: string) =>
    mocks.event?.({
      type: 'comment',
      data: JSON.stringify({
        updateType: 'create-comment',
        payload: { documentId },
      }),
    });
  send('other');
  mocks.event?.({ type: 'comment', data: 'not json' });
  expect(mocks.annotations.getComments).toHaveBeenCalledTimes(1);
  mocks.annotations.getComments.mockResolvedValue(
    ok({ data: [{ thread: { threadId: 8 }, comments: [] }] })
  );
  send('sheet');
  await waitFor(() => expect(state.query.data?.[0]?.thread.threadId).toBe(8));
  expect(mocks.annotations.getComments).toHaveBeenCalledTimes(2);
  client.clear();
});
