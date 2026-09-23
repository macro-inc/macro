import {
  type InitialSync,
  type LiveSyncSource,
  SyncSourceStatus,
} from '@macro-inc/collaboration/collab/source';
import { okAsync, ResultAsync } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import { guardDocumentSyncSource } from './guarded-source';

function setup() {
  const bytes = new Uint8Array([1]);
  const initial: InitialSync = { snapshot: bytes, awareness: bytes };
  let current = true;
  let writable = true;
  let invalidate = () => {};
  const unsubscribe = vi.fn();
  const source: LiveSyncSource = {
    documentId: 'doc',
    status: () => SyncSourceStatus.Connected,
    listen: vi.fn(() => () => {}),
    pushUpdate: vi.fn(async () => true),
    pushAwareness: vi.fn(),
    registerPeerId: vi.fn(),
    requestSnapshot: vi.fn(() => okAsync(bytes)),
    requestUpdatesSince: vi.fn(() => okAsync(bytes)),
    reconnect: vi.fn(),
    cleanup: vi.fn(),
  };
  const pending = Promise.withResolvers<InitialSync>();
  const guarded = guardDocumentSyncSource(
    source,
    () => ResultAsync.fromSafePromise(pending.promise),
    {
      isCurrent: () => current,
      canWrite: () => writable,
      getToken: async () => 'test-token',
      onInvalidated: (listener) => {
        invalidate = listener;
        return unsubscribe;
      },
    }
  );
  return {
    source,
    guarded,
    pending,
    initial,
    unsubscribe,
    revoke() {
      current = false;
      invalidate();
    },
    readonly() {
      writable = false;
    },
  };
}

describe('document session source guard', () => {
  it('blocks writes and closes the source on logout/account switch', async () => {
    const h = setup();
    h.revoke();
    expect(await h.guarded.source.pushUpdate([new Uint8Array([1])])).toBe(
      false
    );
    h.guarded.source.pushAwareness(new Uint8Array([1]));
    h.guarded.source.registerPeerId(1n);
    h.guarded.source.reconnect();
    expect(h.source.pushUpdate).not.toHaveBeenCalled();
    expect(h.source.pushAwareness).not.toHaveBeenCalled();
    expect(h.source.registerPeerId).not.toHaveBeenCalled();
    expect(h.source.reconnect).not.toHaveBeenCalled();
    expect(h.source.cleanup).toHaveBeenCalledOnce();
    expect(h.unsubscribe).toHaveBeenCalledOnce();
    expect(h.guarded.source.status()).toBe(SyncSourceStatus.Disconnected);
    h.guarded.source.cleanup();
    expect(h.source.cleanup).toHaveBeenCalledOnce();
  });

  it('does not release a snapshot completing for a previous session', async () => {
    const h = setup();
    const result = h.guarded.doInitialSync();
    h.revoke();
    h.pending.resolve(h.initial);
    expect((await result)._unsafeUnwrapErr().type).toBe('authorization_error');
    expect(
      (await h.guarded.source.requestSnapshot())._unsafeUnwrapErr().type
    ).toBe('authorization_error');
    expect(h.source.requestSnapshot).not.toHaveBeenCalled();
  });

  it('keeps queued edits unacknowledged when fresh permissions no longer allow them', async () => {
    const h = setup();
    h.readonly();
    expect(await h.guarded.source.pushUpdate([new Uint8Array([1])])).toBe(
      false
    );
    expect(h.source.pushUpdate).not.toHaveBeenCalled();
    h.guarded.source.cleanup();
  });

  it('never places offline edits in the websocket send buffer before reauthorization', async () => {
    const h = setup();
    h.source.status = () => SyncSourceStatus.Disconnected;
    expect(await h.guarded.source.pushUpdate([new Uint8Array([1])])).toBe(
      false
    );
    expect(h.source.pushUpdate).not.toHaveBeenCalled();
    expect(h.source.reconnect).toHaveBeenCalledOnce();
    h.guarded.source.cleanup();
  });
});
