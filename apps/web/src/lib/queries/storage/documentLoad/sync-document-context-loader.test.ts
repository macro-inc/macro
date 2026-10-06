import { ThrownResultError } from '@core/util/result';
import { describe, expect, it, vi } from 'vitest';
import {
  documentContext,
  freshContext,
  harness,
} from './offline-context.test-helpers';

const failure = (code: string) =>
  new ThrownResultError([{ code, message: 'Request failed' }]);

describe('cache-first sync document open', () => {
  it('opens after a restart while authorization is offline, retaining last-known edit permission', async () => {
    const h = harness();
    const online = await h.loader.load('doc-1');
    expect(online.fromCache).toBe(false);
    expect(online.token).toBeUndefined();
    expect(await online.authorization!.getToken()).toBe(freshContext.token);
    expect(h.loadRemote).toHaveBeenCalledTimes(1);

    const restarted = h.restart();
    restarted.loadRemote.mockRejectedValue(failure('NETWORK_ERROR'));
    const offline = await restarted.loader.load('doc-1');
    expect(offline.fromCache).toBe(true);
    expect(offline.userAccessLevel).toBe('edit');
    expect(offline.token).toBeUndefined();
    expect(restarted.loadRemote).not.toHaveBeenCalled();
    await expect(offline.authorization!.getToken()).rejects.toBeInstanceOf(
      ThrownResultError
    );
    expect(
      await restarted.cache.read(restarted.cache.capture()!, 'doc-1')
    ).toEqual(documentContext);
    await h.cache.clear();
  });

  it('reauthorizes every reconnect and persists updated permissions, never the token', async () => {
    const h = harness();
    await h.cache.write(h.cache.capture()!, documentContext);
    const opened = await h.loader.load('doc-1');
    h.loadRemote.mockResolvedValue({
      ...freshContext,
      userAccessLevel: 'view',
      token: 'new-token',
    });
    expect(await opened.authorization!.getToken()).toBe('new-token');
    expect(
      (await h.cache.read(h.cache.capture()!, 'doc-1'))?.userAccessLevel
    ).toBe('view');
    h.loadRemote.mockRejectedValueOnce(failure('NETWORK_ERROR'));
    await expect(opened.authorization!.getToken()).rejects.toBeInstanceOf(
      ThrownResultError
    );
    expect(h.loadRemote).toHaveBeenCalledTimes(2);
    await h.cache.clear();
  });

  it.each(['view', 'comment'] as const)(
    'blocks an active cached editor from sending edits after downgrade to %s',
    async (userAccessLevel) => {
      const h = harness();
      await h.cache.write(h.cache.capture()!, documentContext);
      const opened = await h.loader.load('doc-1');
      expect(opened.authorization!.canWrite()).toBe(false);
      h.loadRemote.mockResolvedValue({ ...freshContext, userAccessLevel });
      await opened.authorization!.getToken();
      expect(opened.authorization!.canWrite()).toBe(false);
      h.loadRemote.mockResolvedValue(freshContext);
      await opened.authorization!.getToken();
      expect(opened.authorization!.canWrite()).toBe(true);
      await h.cache.clear();
    }
  );

  it.each(['FORBIDDEN', 'NOT_FOUND', 'INVALID'])(
    'evicts on definitive %s without opening a sync connection',
    async (code) => {
      const h = harness();
      await h.cache.write(h.cache.capture()!, documentContext);
      const opened = await h.loader.load('doc-1');
      const invalidated = vi.fn();
      const stop = opened.authorization!.onInvalidated(invalidated);
      h.loadRemote.mockRejectedValue(failure(code));
      await expect(opened.authorization!.getToken()).rejects.toBeInstanceOf(
        ThrownResultError
      );
      expect(invalidated).toHaveBeenCalledOnce();
      expect(opened.authorization!.isCurrent()).toBe(false);
      expect(await h.cache.read(h.cache.capture()!, 'doc-1')).toBeUndefined();
      stop();
      await h.cache.clear();
    }
  );

  it.each(['UNAUTHORIZED', 'NETWORK_ERROR', 'INTERNAL_SERVER_ERROR'])(
    'preserves cached access on an unconfirmed/transient %s',
    async (code) => {
      const h = harness();
      await h.cache.write(h.cache.capture()!, documentContext);
      const opened = await h.loader.load('doc-1');
      h.loadRemote.mockRejectedValue(failure(code));
      await expect(opened.authorization!.getToken()).rejects.toBeInstanceOf(
        ThrownResultError
      );
      expect(opened.authorization!.isCurrent()).toBe(true);
      expect(await h.cache.read(h.cache.capture()!, 'doc-1')).toEqual(
        documentContext
      );
      await h.cache.clear();
    }
  );

  it('does not bootstrap an empty editable document when the snapshot is missing', async () => {
    const h = harness();
    await h.cache.write(h.cache.capture()!, documentContext);
    h.hasLocalSnapshot.mockResolvedValue(false);
    h.loadRemote.mockRejectedValue(failure('NETWORK_ERROR'));
    await expect(h.loader.load('doc-1')).rejects.toBeInstanceOf(
      ThrownResultError
    );
    expect(h.loadRemote).toHaveBeenCalledOnce();
    await h.cache.clear();
  });

  it('invalidates an open source on account switch and never reuses the other account context', async () => {
    const h = harness();
    await h.cache.write(h.cache.capture()!, documentContext);
    const opened = await h.loader.load('doc-1');
    const invalidated = vi.fn();
    const stop = opened.authorization!.onInvalidated(invalidated);
    h.identify({ userId: 'viewer-b', epoch: 'login-1' });
    expect(invalidated).toHaveBeenCalledOnce();
    await expect(opened.authorization!.getToken()).rejects.toBeInstanceOf(
      ThrownResultError
    );
    expect(h.loadRemote).not.toHaveBeenCalled();
    h.loadRemote.mockRejectedValue(failure('NETWORK_ERROR'));
    await expect(h.loader.load('doc-1')).rejects.toBeInstanceOf(
      ThrownResultError
    );
    stop();
    await h.cache.clear();
  });

  it('discards a network result that completes after logout', async () => {
    const h = harness();
    const response = Promise.withResolvers<typeof freshContext>();
    h.loadRemote.mockReturnValue(response.promise);
    const loading = h.loader.load('doc-1');
    await vi.waitFor(() => expect(h.loadRemote).toHaveBeenCalledOnce());
    await h.cache.clear();
    response.resolve(freshContext);
    await expect(loading).rejects.toBeInstanceOf(ThrownResultError);
    expect(await h.cache.read(h.cache.capture()!, 'doc-1')).toBeUndefined();
  });

  it('keeps the existing non-native network path without persisting context', async () => {
    const h = harness();
    h.identify(undefined);
    const write = vi.spyOn(h.store, 'set');
    const opened = await h.loader.load('doc-1');
    expect(opened.token).toBe(freshContext.token);
    expect(opened.authorization).toBeUndefined();
    expect(write).not.toHaveBeenCalled();
    await h.cache.clear();
  });
});
