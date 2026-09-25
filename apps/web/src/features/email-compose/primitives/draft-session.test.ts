import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import {
  createDraftSession,
  type DraftSessionEvent,
  type DraftSessionState,
  initialDraftSession,
  reduceDraftSession,
} from './draft-session';

const none = initialDraftSession();
const seeded = initialDraftSession({ draftId: 'server-1', threadId: 't-1' });
const handle = reduceDraftSession(none, {
  type: 'minted',
  draftId: 'h-1',
  threadId: 'th-1',
});
const latched: DraftSessionState = {
  ...handle,
  policy: { kind: 'latched', code: 'INVALID' },
};

describe('reduceDraftSession', () => {
  it('seeds a server identity from an existing draft, none otherwise', () => {
    expect(seeded.identity).toEqual({
      kind: 'server',
      queued: false,
      draftId: 'server-1',
      threadId: 't-1',
    });
    expect(none.identity).toEqual({ kind: 'none' });
    expect(none.policy).toEqual({ kind: 'autosaving' });
  });

  it('mints handles only for a draft with no identity', () => {
    expect(handle.identity).toEqual({
      kind: 'handle',
      draftId: 'h-1',
      threadId: 'th-1',
      queued: false,
    });
    const minted = { type: 'minted', draftId: 'h-2' } as const;
    expect(reduceDraftSession(handle, minted)).toBe(handle);
    expect(reduceDraftSession(seeded, minted)).toBe(seeded);
  });

  it('a committed save confirms the server identity, keeping a known thread', () => {
    const next = reduceDraftSession(handle, {
      type: 'saved',
      epoch: handle.epoch,
      identity: { draftId: 'server-2', persistence: 'committed' },
    });
    expect(next.identity).toEqual({
      kind: 'server',
      queued: false,
      draftId: 'server-2',
      threadId: 'th-1',
    });
    // Absent persistence is a committed REST save.
    expect(
      reduceDraftSession(handle, {
        type: 'saved',
        epoch: handle.epoch,
        identity: { draftId: 'server-3', threadId: 't-9' },
      }).identity
    ).toEqual({
      kind: 'server',
      draftId: 'server-3',
      threadId: 't-9',
      queued: false,
    });
  });

  it('a queued save never confirms: handles stay handles, server ids stay', () => {
    expect(
      reduceDraftSession(handle, {
        type: 'saved',
        epoch: handle.epoch,
        identity: { draftId: 'h-1', persistence: 'queued' },
      }).identity
    ).toEqual({
      kind: 'handle',
      draftId: 'h-1',
      threadId: 'th-1',
      queued: true,
    });
    expect(
      reduceDraftSession(seeded, {
        type: 'saved',
        epoch: seeded.epoch,
        identity: { draftId: 'server-1', persistence: 'queued' },
      })
    ).toEqual({ ...seeded, identity: { ...seeded.identity, queued: true } });
  });

  it('invalidates pending writes when undo restores a different draft', () => {
    const restored = reduceDraftSession(handle, {
      type: 'seeded',
      draftId: 'restored',
    });
    const lateSave = reduceDraftSession(restored, {
      type: 'saved',
      epoch: handle.epoch,
      identity: { draftId: 'old-draft' },
    });
    expect(lateSave.identity).toMatchObject({ draftId: 'restored' });
  });

  it('ignores outcomes from before a reset', () => {
    const afterReset = reduceDraftSession(handle, { type: 'reset' });
    expect(afterReset.epoch).toBe(handle.epoch + 1);
    const stale: DraftSessionEvent[] = [
      {
        type: 'saved',
        epoch: handle.epoch,
        identity: { draftId: 'server-2', persistence: 'committed' },
      },
      { type: 'rejected', epoch: handle.epoch, code: 'INVALID' },
      { type: 'rejected', epoch: handle.epoch, code: 'DRAFT_ALREADY_SENT' },
    ];
    for (const event of stale) {
      expect(reduceDraftSession(afterReset, event)).toBe(afterReset);
    }
  });

  it('a deterministic rejection latches autosave and keeps the identity', () => {
    const next = reduceDraftSession(handle, {
      type: 'rejected',
      epoch: handle.epoch,
      code: 'UNAUTHORIZED',
    });
    expect(next.policy).toEqual({ kind: 'latched', code: 'UNAUTHORIZED' });
    expect(next.identity).toBe(handle.identity);
    expect(next.epoch).toBe(handle.epoch);
  });

  it('already-sent drops the draft like a reset', () => {
    const next = reduceDraftSession(seeded, {
      type: 'rejected',
      epoch: seeded.epoch,
      code: 'DRAFT_ALREADY_SENT',
    });
    expect(next).toEqual({
      identity: { kind: 'none' },
      policy: { kind: 'autosaving' },
      epoch: seeded.epoch + 1,
    });
  });

  it('emptied and reset start a fresh draft and lift the latch', () => {
    for (const type of ['emptied', 'reset'] as const) {
      const next = reduceDraftSession(latched, { type });
      expect(next.identity).toEqual({ kind: 'none' });
      expect(next.policy).toEqual({ kind: 'autosaving' });
      expect(next.epoch).toBe(latched.epoch + 1);
    }
  });

  it('ordinary persistence events cannot clear a rejection latch', () => {
    const keepsLatch: DraftSessionEvent[] = [
      { type: 'minted', draftId: 'h-9' },
      {
        type: 'saved',
        epoch: latched.epoch,
        identity: { draftId: 'server-9', persistence: 'committed' },
      },
      {
        type: 'saved',
        epoch: latched.epoch,
        identity: { draftId: 'h-1', persistence: 'queued' },
      },
      { type: 'rejected', epoch: latched.epoch, code: 'INTERNAL' },
    ];
    for (const event of keepsLatch) {
      expect(reduceDraftSession(latched, event).policy.kind).toBe('latched');
    }
  });

  it('adopts inbox, message, and thread atomically only after migration commits', () => {
    const before = initialDraftSession({
      draftId: 'draft-a',
      threadId: 'thread-a',
      inboxId: 'inbox-a',
    });
    const queued = reduceDraftSession(before, {
      type: 'saved',
      epoch: before.epoch,
      identity: {
        draftId: 'draft-b',
        threadId: 'thread-b',
        inboxId: 'inbox-b',
        persistence: 'queued',
      },
    });
    expect(queued.identity).toEqual({ ...before.identity, queued: true });
    const committed = reduceDraftSession(queued, {
      type: 'saved',
      epoch: queued.epoch,
      identity: {
        draftId: 'draft-b',
        threadId: 'thread-b',
        inboxId: 'inbox-b',
        persistence: 'committed',
      },
    });
    expect(committed.identity).toEqual({
      kind: 'server',
      draftId: 'draft-b',
      threadId: 'thread-b',
      inboxId: 'inbox-b',
      queued: false,
    });
  });

  it('authoritative cancellation clears a schedule rejection without changing identity', () => {
    const rejected: DraftSessionState = { ...seeded, policy: latched.policy };
    const resumed = reduceDraftSession(rejected, {
      type: 'schedule-cancelled',
    });
    expect(resumed.identity).toBe(rejected.identity);
    expect(resumed.policy.kind).toBe('autosaving');
    expect(resumed.epoch).toBe(rejected.epoch + 1);
    const unauthorized: DraftSessionState = {
      ...rejected,
      policy: { kind: 'latched', code: 'UNAUTHORIZED' },
    };
    expect(
      reduceDraftSession(unauthorized, { type: 'schedule-cancelled' })
    ).toBe(unauthorized);
  });
});

describe('createDraftSession', () => {
  it('derives the send and autosave predicates from state', () => {
    createRoot((dispose) => {
      const session = createDraftSession();
      expect(session.serverConfirmed()).toBe(false);
      expect(session.autosaveAllowed()).toBe(true);
      session.dispatch({ type: 'minted', draftId: 'h-1', threadId: 'th-1' });
      const epoch = session.epoch();
      expect(session.draftId()).toBe('h-1');
      expect(session.serverConfirmed()).toBe(false);
      session.dispatch({
        type: 'saved',
        epoch,
        identity: { draftId: 'h-1', persistence: 'queued' },
      });
      expect(session.serverConfirmed()).toBe(false);
      session.dispatch({
        type: 'saved',
        epoch,
        identity: { draftId: 'server-1', persistence: 'committed' },
      });
      expect(session.serverConfirmed()).toBe(true);
      expect(session.draftId()).toBe('server-1');
      expect(session.threadId()).toBe('th-1');
      session.dispatch({ type: 'rejected', epoch, code: 'INVALID' });
      expect(session.autosaveAllowed()).toBe(false);
      session.dispatch({ type: 'reset' });
      expect(session.isStale(epoch)).toBe(true);
      expect(session.draftId()).toBeUndefined();
      expect(session.autosaveAllowed()).toBe(true);
      dispose();
    });
  });
});
