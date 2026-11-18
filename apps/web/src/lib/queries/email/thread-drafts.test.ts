import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchThread: vi.fn(),
  listLocal: vi.fn(),
  queueActive: vi.fn(() => true),
}));

vi.mock('./thread', () => ({ fetchAndCacheThread: mocks.fetchThread }));
vi.mock('./local-drafts', () => ({ listLocalDrafts: mocks.listLocal }));
vi.mock('./draft-queue', () => ({ draftQueueActive: mocks.queueActive }));

import { readThreadDrafts } from './thread-drafts';

const message = (overrides: Record<string, unknown>) => ({
  db_id: 'm1',
  is_draft: false,
  draft_generation: 0,
  link_id: 'inbox',
  scheduled_send_time: null,
  ...overrides,
});

const local = (overrides: Record<string, unknown>) => ({
  key: 'key-1',
  draftId: 'local-1',
  threadId: 'thread-1',
  status: 'unconfirmed',
  inboxId: 'inbox',
  content: { draft_generation: 2 },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queueActive.mockReturnValue(true);
  mocks.listLocal.mockResolvedValue([]);
});

describe('readThreadDrafts', () => {
  it("returns the thread's server drafts, skipping scheduled sends", async () => {
    mocks.fetchThread.mockResolvedValue(
      ok({
        thread: {
          messages: [
            message({ db_id: 'received' }),
            message({ db_id: 'draft', is_draft: true, draft_generation: 4 }),
            message({
              db_id: 'scheduled',
              is_draft: true,
              scheduled_send_time: '2026-11-03T09:00:00Z',
            }),
          ],
        },
      })
    );

    const result = await readThreadDrafts('thread-1');

    expect(result._unsafeUnwrap()).toEqual([
      {
        draftId: 'draft',
        draftGeneration: 4,
        threadId: 'thread-1',
        inboxId: 'inbox',
      },
    ]);
  });

  it('discards a working copy that exists only on this device', async () => {
    mocks.listLocal.mockResolvedValue([
      local({ threadId: undefined, key: 'row-key' }),
      local({ draftId: 'synced', status: 'synced', key: 'row-key' }),
    ]);
    mocks.fetchThread.mockResolvedValue(
      err([{ code: 'NOT_FOUND', message: 'Email thread not found' }])
    );

    const result = await readThreadDrafts('row-key');

    expect(result._unsafeUnwrap()).toEqual([
      {
        draftId: 'local-1',
        draftGeneration: 2,
        threadId: 'row-key',
        inboxId: 'inbox',
      },
    ]);
  });

  it('deletes a working copy once when the server also has it', async () => {
    mocks.listLocal.mockResolvedValue([local({ serverDraftId: 'server-1' })]);
    mocks.fetchThread.mockResolvedValue(
      ok({
        thread: {
          messages: [message({ db_id: 'server-1', is_draft: true })],
        },
      })
    );

    const result = await readThreadDrafts('thread-1');

    expect(result._unsafeUnwrap().map(({ draftId }) => draftId)).toEqual([
      'local-1',
    ]);
  });

  it('reports a thread it cannot read and has no local copy of', async () => {
    mocks.fetchThread.mockResolvedValue(
      err([{ code: 'NOT_FOUND', message: 'Email thread not found' }])
    );

    const result = await readThreadDrafts('thread-1');

    expect(result._unsafeUnwrapErr()).toEqual({
      kind: 'thread-unavailable',
      codes: ['NOT_FOUND'],
    });
  });

  it('ignores local drafts when the draft queue is off', async () => {
    mocks.queueActive.mockReturnValue(false);
    mocks.fetchThread.mockResolvedValue(ok({ thread: { messages: [] } }));

    await readThreadDrafts('thread-1');

    expect(mocks.listLocal).not.toHaveBeenCalled();
  });
});
