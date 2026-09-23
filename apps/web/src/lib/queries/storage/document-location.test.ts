import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '../client';
import {
  waitForDocumentContentReady,
  waitForDocumentPresignedUrlReady,
  waitForDocumentSyncServiceReady,
} from './document-location';
import {
  documentContext,
  freshContext,
  harness,
} from './documentLoad/offline-context.test-helpers';

const mocks = vi.hoisted(() => ({
  getLocation: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    getDocumentLocation: Object.assign(mocks.getLocation, {
      invalidate: mocks.invalidate,
    }),
  },
}));
vi.mock('../client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
  };
});

const pending = {
  type: 'presignedUrl',
  content: { state: 'pending' },
} as const;
const ready = {
  type: 'syncServiceContent',
  content: { state: 'ready' },
} as const;
const args = { documentId: 'doc-1', timeoutMs: 0 };

beforeEach(() => vi.resetAllMocks());
afterEach(() => queryClient.clear());

describe('sync-service readiness', () => {
  it('returns a ready sync-service location', async () => {
    mocks.getLocation.mockResolvedValue(ok({ data: ready }));
    expect(await waitForDocumentSyncServiceReady(args)).toEqual(ready);
  });

  it.each(['pending', 'unknown'] as const)(
    'reports a transient timeout when readiness expires in state %s',
    async (state) => {
      mocks.getLocation.mockResolvedValue(
        ok({ data: { ...pending, content: { state } } })
      );
      await expect(waitForDocumentSyncServiceReady(args)).rejects.toMatchObject(
        {
          errors: [{ code: 'TIMEOUT' }],
        }
      );
    }
  );

  it.each(['FORBIDDEN', 'NOT_FOUND', 'NETWORK_ERROR'])(
    'preserves a %s response after an earlier pending location',
    async (code) => {
      mocks.getLocation
        .mockResolvedValueOnce(ok({ data: pending }))
        .mockResolvedValue(err([{ code, message: 'Location request failed' }]));
      await expect(
        waitForDocumentSyncServiceReady({
          ...args,
          timeoutMs: 1000,
          initialDelayMs: 0,
          maxDelayMs: 0,
        })
      ).rejects.toMatchObject({ errors: [{ code }] });
    }
  );

  it('returns a ready non-sync location for the caller to reject as invalid', async () => {
    const location = { ...pending, content: { state: 'ready' } };
    mocks.getLocation.mockResolvedValue(ok({ data: location }));
    expect(await waitForDocumentSyncServiceReady(args)).toEqual(location);
  });

  it('retains cached authorization after timeout and allows a later successful retry', async () => {
    const h = harness();
    try {
      await h.cache.write(h.cache.capture()!, documentContext);
      h.loadRemote.mockImplementation(async () => {
        await waitForDocumentSyncServiceReady(args);
        return freshContext;
      });
      const opened = await h.loader.load('doc-1');
      const invalidated = vi.fn();
      const stop = opened.authorization!.onInvalidated(invalidated);
      mocks.getLocation.mockResolvedValue(ok({ data: pending }));
      await expect(opened.authorization!.getToken()).rejects.toMatchObject({
        errors: [{ code: 'TIMEOUT' }],
      });
      expect(opened.authorization!.isCurrent()).toBe(true);
      expect(opened.authorization!.canWrite()).toBe(false);
      expect(invalidated).not.toHaveBeenCalled();
      expect(await h.cache.read(h.cache.capture()!, 'doc-1')).toEqual(
        documentContext
      );

      mocks.getLocation.mockResolvedValue(ok({ data: ready }));
      expect(await opened.authorization!.getToken()).toBe(freshContext.token);
      expect(opened.authorization!.canWrite()).toBe(true);
      stop();
    } finally {
      await h.cache.clear();
    }
  });

  it.each([waitForDocumentContentReady, waitForDocumentPresignedUrlReady])(
    'keeps the existing last-location fallback for non-sync waiters',
    async (waitForReady) => {
      mocks.getLocation.mockResolvedValue(ok({ data: pending }));
      expect(await waitForReady(args)).toEqual(pending);
    }
  );
});
