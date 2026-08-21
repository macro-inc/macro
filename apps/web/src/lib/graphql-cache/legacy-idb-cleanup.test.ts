import { afterEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { deleteLegacyNormalizedCacheIdb } from './legacy-idb-cleanup';

type MutableDeleteRequest = Pick<
  IDBOpenDBRequest,
  'onblocked' | 'onerror' | 'onsuccess'
>;

function deleteRequest(): MutableDeleteRequest {
  return {
    onblocked: null,
    onerror: null,
    onsuccess: null,
  };
}

function dispatch(
  request: MutableDeleteRequest,
  kind: 'blocked' | 'error' | 'success'
): MockInstance<Event['preventDefault']> {
  if (kind === 'blocked') {
    const event: IDBVersionChangeEvent = Object.assign(new Event(kind), {
      newVersion: null,
      oldVersion: 0,
    });
    const preventDefault = vi.spyOn(event, 'preventDefault');
    request.onblocked?.call(request as IDBOpenDBRequest, event);
    return preventDefault;
  }

  const event = new Event(kind);
  const preventDefault = vi.spyOn(event, 'preventDefault');
  const handler = kind === 'error' ? request.onerror : request.onsuccess;
  handler?.call(request as IDBOpenDBRequest, event);
  return preventDefault;
}

describe('deleteLegacyNormalizedCacheIdb', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('deletes only the exact former database name without opening or enumerating IDB', async () => {
    const request = deleteRequest();
    const deleteDatabase = vi.fn(() => request);
    const open = vi.fn();
    const databases = vi.fn();
    vi.stubGlobal('indexedDB', { deleteDatabase, open, databases });

    const attempt = deleteLegacyNormalizedCacheIdb('scope:s1:v2');

    expect(deleteDatabase).toHaveBeenCalledOnce();
    expect(deleteDatabase).toHaveBeenCalledWith('graphql-cache:scope:s1:v2');
    expect(open).not.toHaveBeenCalled();
    expect(databases).not.toHaveBeenCalled();
    expect(deleteDatabase).not.toHaveBeenCalledWith(
      'unrelated-idb:scope:s1:v2'
    );
    dispatch(request, 'success');
    await expect(attempt).resolves.toBeUndefined();
  });

  it('settles on blocked while allowing the same request to complete later', async () => {
    const request = deleteRequest();
    vi.stubGlobal('indexedDB', {
      deleteDatabase: vi.fn(() => request),
    });
    const attempt = deleteLegacyNormalizedCacheIdb('blocked-scope');

    expect(dispatch(request, 'blocked')).not.toHaveBeenCalled();
    await expect(attempt).resolves.toBeUndefined();

    expect(() => dispatch(request, 'success')).not.toThrow();
    const preventDefault = dispatch(request, 'error');
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it('settles and suppresses an IndexedDB request error', async () => {
    const request = deleteRequest();
    vi.stubGlobal('indexedDB', {
      deleteDatabase: vi.fn(() => request),
    });
    const attempt = deleteLegacyNormalizedCacheIdb('error-scope');

    const preventDefault = dispatch(request, 'error');

    expect(preventDefault).toHaveBeenCalledOnce();
    await expect(attempt).resolves.toBeUndefined();
  });

  it.each([
    ['missing API', undefined],
    [
      'synchronous deletion failure',
      {
        deleteDatabase: vi.fn(() => {
          throw new DOMException('denied', 'SecurityError');
        }),
      },
    ],
  ])('settles when IndexedDB is unavailable: %s', async (label, factory) => {
    vi.stubGlobal('indexedDB', factory);

    await expect(
      deleteLegacyNormalizedCacheIdb(`unavailable-${label}`)
    ).resolves.toBeUndefined();
  });

  it('attempts deletion once per scope for the module session', async () => {
    const firstRequest = deleteRequest();
    const secondRequest = deleteRequest();
    const deleteDatabase = vi
      .fn()
      .mockReturnValueOnce(firstRequest)
      .mockReturnValueOnce(secondRequest);
    vi.stubGlobal('indexedDB', { deleteDatabase });

    const first = deleteLegacyNormalizedCacheIdb('same-scope');
    const duplicate = deleteLegacyNormalizedCacheIdb('same-scope');
    expect(duplicate).toBe(first);
    expect(deleteDatabase).toHaveBeenCalledOnce();
    dispatch(firstRequest, 'success');
    await first;

    await deleteLegacyNormalizedCacheIdb('same-scope');
    expect(deleteDatabase).toHaveBeenCalledOnce();

    const other = deleteLegacyNormalizedCacheIdb('other-scope');
    expect(deleteDatabase).toHaveBeenNthCalledWith(
      2,
      'graphql-cache:other-scope'
    );
    dispatch(secondRequest, 'success');
    await other;
  });
});
