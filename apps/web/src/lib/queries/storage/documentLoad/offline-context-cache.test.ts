import { describe, expect, it, vi } from 'vitest';
import { documentContext, harness } from './offline-context.test-helpers';

describe('offline document context persistence', () => {
  it('survives a new cache instance without persisting tokens or opaque metadata', async () => {
    const h = harness();
    const session = h.cache.capture()!;
    const write = vi.spyOn(h.store, 'set');
    const unsafe = {
      ...documentContext,
      token: 'credential-secret',
      documentMetadata: {
        ...documentContext.documentMetadata,
        token: 'credential-secret',
        modificationData: { signedUrl: 'credential-secret' },
        documentBom: [{ id: 'part', path: 'credential-secret', sha: 'hash' }],
      },
    };
    await h.cache.write(session, unsafe);
    expect(JSON.stringify(write.mock.calls[0][0])).not.toContain(
      'credential-secret'
    );
    const restarted = h.restart();
    expect(
      await restarted.cache.read(restarted.cache.capture()!, 'doc-1')
    ).toEqual(documentContext);
    await h.cache.clear();
  });

  it('never exposes another user or login epoch', async () => {
    const h = harness();
    await h.cache.write(h.cache.capture()!, documentContext);
    h.identify({ userId: 'viewer-b', epoch: 'login-1' });
    expect(await h.cache.read(h.cache.capture()!, 'doc-1')).toBeUndefined();
    h.identify({ userId: 'viewer-a', epoch: 'login-2' });
    expect(await h.cache.read(h.cache.capture()!, 'doc-1')).toBeUndefined();
    h.identify(undefined);
    expect(h.cache.capture()).toBeUndefined();
    await h.cache.clear();
  });

  it('fences pending reads and late writes after logout, including the same user signing back in', async () => {
    const h = harness();
    const session = h.cache.capture()!;
    await h.cache.write(session, documentContext);
    const blocked = Promise.withResolvers<void>();
    const read = h.store.get;
    vi.spyOn(h.store, 'get').mockImplementation(async (key) => {
      await blocked.promise;
      return read(key);
    });
    const pending = h.cache.read(session, 'doc-1');
    await h.cache.clear();
    await h.cache.write(session, documentContext);
    blocked.resolve();
    expect(await pending).toBeUndefined();
    expect(await h.cache.read(h.cache.capture()!, 'doc-1')).toBeUndefined();
  });

  it('rejects mismatched, deleted, and incompatible records', async () => {
    const h = harness();
    const session = h.cache.capture()!;
    const write = vi.spyOn(h.store, 'set');
    await h.cache.write(session, documentContext);
    const entry = write.mock.calls[0][0];
    const invalid = [
      { ...entry, buster: 'old-version' },
      { ...entry, data: { ...documentContext, userAccessLevel: 'admin' } },
      {
        ...entry,
        data: {
          ...documentContext,
          documentMetadata: {
            ...documentContext.documentMetadata,
            documentId: 'other-document',
          },
        },
      },
      {
        ...entry,
        data: {
          ...documentContext,
          documentMetadata: {
            ...documentContext.documentMetadata,
            deletedAt: new Date().toISOString(),
          },
        },
      },
    ];
    for (const value of invalid) {
      h.store.set(value);
      await h.store.flush();
      expect(await h.cache.read(session, 'doc-1')).toBeUndefined();
    }
    await h.cache.clear();
  });

  it('removes an older grant when metadata confirms deletion', async () => {
    const h = harness();
    const session = h.cache.capture()!;
    await h.cache.write(session, documentContext);
    await h.cache.write(session, {
      ...documentContext,
      documentMetadata: {
        ...documentContext.documentMetadata,
        deletedAt: new Date().toISOString(),
      },
    });
    expect(await h.cache.read(session, 'doc-1')).toBeUndefined();
    await h.cache.clear();
  });
});
