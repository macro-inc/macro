import { afterEach, describe, expect, it, vi } from 'vitest';

const executeMock = vi.hoisted(() => vi.fn());
const deleteMock = vi.hoisted(() => vi.fn());
const settlementCallbacks = vi.hoisted(
  () => new Set<(settlement: unknown) => void>()
);

vi.mock('@service-storage/graphql-email-draft', () => ({
  executeGraphqlSaveEmailDraft: executeMock,
  executeGraphqlDeleteEmailDraft: deleteMock,
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => ({}),
  getGraphqlSoupCacheHost: () => ({
    onMutationSettled: (callback: (settlement: unknown) => void) => {
      settlementCallbacks.add(callback);
      return () => settlementCallbacks.delete(callback);
    },
  }),
}));

import {
  cancelPendingDraftSave,
  onDraftSaveSettlement,
  submitDraftDelete,
  submitDraftSave,
} from './draft-save-coalescer';

function emitSettlement(settlement: {
  transactionId: string;
  status: 'committed' | 'permanently-failed';
  error?: string;
}) {
  for (const callback of settlementCallbacks) callback(settlement);
}

function args(draftId: string, subject: string) {
  return {
    draftId,
    threadDbId: 'thread-1',
    subject,
    senderLinkId: 'link-1',
    senderEmail: 'user@test.com',
    optimisticBodyHtml: '<p>body</p>',
  };
}

let nextId = 0;
function uniqueDraftId() {
  nextId += 1;
  return `draft-${nextId}`;
}

async function settleMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('draft-save-coalescer', () => {
  afterEach(() => {
    executeMock.mockReset();
    deleteMock.mockReset();
    vi.useRealTimers();
  });

  it('dispatches immediately when nothing is outstanding', async () => {
    const draftId = uniqueDraftId();
    executeMock.mockResolvedValueOnce({
      kind: 'committed',
      draftId,
      threadId: 'thread-1',
    });

    const outcome = await submitDraftSave(args(draftId, 'first'));

    expect(outcome.kind).toBe('committed');
    expect(executeMock).toHaveBeenCalledOnce();
  });

  it('buffers latest-wins behind an unsettled queued save, dispatching on commit', async () => {
    const draftId = uniqueDraftId();
    executeMock.mockResolvedValueOnce({
      kind: 'queued',
      transactionId: 'tx-1',
    });

    const first = await submitDraftSave(args(draftId, 'v1'));
    expect(first.kind).toBe('queued');

    const second = await submitDraftSave(args(draftId, 'v2'));
    const third = await submitDraftSave(args(draftId, 'v3'));
    expect(second.kind).toBe('buffered');
    expect(third.kind).toBe('buffered');
    expect(executeMock).toHaveBeenCalledOnce();

    executeMock.mockResolvedValueOnce({
      kind: 'committed',
      draftId,
      threadId: 'thread-1',
    });
    emitSettlement({ transactionId: 'tx-1', status: 'committed' });
    await settleMicrotasks();

    expect(executeMock).toHaveBeenCalledTimes(2);
    expect(executeMock.mock.calls[1]?.[1]).toMatchObject({ subject: 'v3' });
  });

  it('force-dispatches lifecycle-edge saves past an unsettled one', async () => {
    const draftId = uniqueDraftId();
    executeMock.mockResolvedValue({ kind: 'queued', transactionId: 'tx-2' });

    await submitDraftSave(args(draftId, 'v1'));
    const edge = await submitDraftSave(args(draftId, 'final'), { force: true });

    expect(edge.kind).toBe('queued');
    expect(executeMock).toHaveBeenCalledTimes(2);
  });

  it('drops buffered content on cancel', async () => {
    const draftId = uniqueDraftId();
    executeMock.mockResolvedValueOnce({
      kind: 'queued',
      transactionId: 'tx-3',
    });

    await submitDraftSave(args(draftId, 'v1'));
    await submitDraftSave(args(draftId, 'stale'));
    cancelPendingDraftSave(draftId);

    emitSettlement({ transactionId: 'tx-3', status: 'committed' });
    await settleMicrotasks();

    expect(executeMock).toHaveBeenCalledOnce();
  });

  it('reports permanent failures and never redispatches the buffer', async () => {
    const draftId = uniqueDraftId();
    executeMock.mockResolvedValueOnce({
      kind: 'queued',
      transactionId: 'tx-4',
    });
    const settlements: unknown[] = [];
    const unsubscribe = onDraftSaveSettlement(draftId, (settlement) =>
      settlements.push(settlement)
    );

    await submitDraftSave(args(draftId, 'v1'));
    await submitDraftSave(args(draftId, 'v2'));
    emitSettlement({
      transactionId: 'tx-4',
      status: 'permanently-failed',
      error: 'referenced email message not found',
    });
    await settleMicrotasks();

    expect(settlements).toEqual([
      { status: 'failed', message: 'referenced email message not found' },
    ]);
    expect(executeMock).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it('refuses further saves for a draft latched by a permanent failure', async () => {
    const draftId = uniqueDraftId();
    executeMock.mockResolvedValueOnce({
      kind: 'queued',
      transactionId: 'tx-6',
    });

    await submitDraftSave(args(draftId, 'v1'));
    emitSettlement({
      transactionId: 'tx-6',
      status: 'permanently-failed',
      error: 'referenced email message not found',
    });
    await settleMicrotasks();

    const refused = await submitDraftSave(args(draftId, 'v2'));
    // The lifecycle flush must not push a known-doomed save either.
    const forced = await submitDraftSave(args(draftId, 'final'), {
      force: true,
    });

    expect(refused).toEqual({
      kind: 'latched',
      message: 'referenced email message not found',
    });
    expect(forced).toEqual({
      kind: 'latched',
      message: 'referenced email message not found',
    });
    expect(executeMock).toHaveBeenCalledOnce();
  });

  it('replays a recorded failure to a composer that subscribes afterwards', async () => {
    const draftId = uniqueDraftId();
    executeMock.mockResolvedValueOnce({
      kind: 'queued',
      transactionId: 'tx-7',
    });

    // The composer that dispatched unmounts before the settlement lands.
    const unsubscribeFirst = onDraftSaveSettlement(draftId, () => {});
    await submitDraftSave(args(draftId, 'v1'));
    unsubscribeFirst();

    emitSettlement({
      transactionId: 'tx-7',
      status: 'permanently-failed',
      error: 'inbox not found',
    });
    await settleMicrotasks();

    const settlements: unknown[] = [];
    const unsubscribe = onDraftSaveSettlement(draftId, (settlement) =>
      settlements.push(settlement)
    );

    expect(settlements).toEqual([
      { status: 'failed', message: 'inbox not found' },
    ]);
    unsubscribe();
  });

  it('drops buffered content when the draft is deleted', async () => {
    const draftId = uniqueDraftId();
    executeMock.mockResolvedValueOnce({
      kind: 'queued',
      transactionId: 'tx-8',
    });
    deleteMock.mockResolvedValueOnce({
      kind: 'queued',
      transactionId: 'tx-9',
    });

    await submitDraftSave(args(draftId, 'v1'));
    await submitDraftSave(args(draftId, 'stale'));
    const outcome = await submitDraftDelete({
      draftId,
      threadDbId: 'thread-1',
    });
    expect(outcome.kind).toBe('queued');
    expect(deleteMock).toHaveBeenCalledOnce();

    // The unsettled save's commit must not resurrect the dropped buffer.
    emitSettlement({ transactionId: 'tx-8', status: 'committed' });
    await settleMicrotasks();

    expect(executeMock).toHaveBeenCalledOnce();
  });

  it('still deletes a draft latched by a permanent save failure', async () => {
    const draftId = uniqueDraftId();
    executeMock.mockResolvedValueOnce({
      kind: 'queued',
      transactionId: 'tx-10',
    });
    deleteMock.mockResolvedValueOnce({
      kind: 'committed',
      deleted: true,
      threadDeleted: false,
    });

    await submitDraftSave(args(draftId, 'v1'));
    emitSettlement({
      transactionId: 'tx-10',
      status: 'permanently-failed',
      error: 'referenced email message not found',
    });
    await settleMicrotasks();

    const outcome = await submitDraftDelete({
      draftId,
      threadDbId: 'thread-1',
    });

    expect(outcome.kind).toBe('committed');
    expect(deleteMock).toHaveBeenCalledOnce();
  });

  it('dispatches held content after the bounded hold', async () => {
    vi.useFakeTimers();
    const draftId = uniqueDraftId();
    executeMock.mockResolvedValue({ kind: 'queued', transactionId: 'tx-5' });

    await submitDraftSave(args(draftId, 'v1'));
    await submitDraftSave(args(draftId, 'held'));
    expect(executeMock).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(30_000);

    expect(executeMock).toHaveBeenCalledTimes(2);
    expect(executeMock.mock.calls[1]?.[1]).toMatchObject({ subject: 'held' });
  });
});
