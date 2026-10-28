import { queryClient } from '@queries/client';
import { fetchFileDocumentOpenContext } from '@queries/storage/documentLoad/sync-document-context';
import { createSyncServiceSource } from '@service-sync/source';
import type { DocumentSyncAuthorization } from '@service-sync/source/authorization';
import { err, ok } from 'neverthrow';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { canvasSyncSource } from './canvas-sync';

vi.mock('@queries/client', () => ({
  queryClient: { invalidateQueries: vi.fn() },
}));
vi.mock('@queries/storage/documentLoad/sync-document-context', () => ({
  fetchFileDocumentOpenContext: vi.fn(),
}));
vi.mock('@service-sync/source', () => ({ createSyncServiceSource: vi.fn() }));
vi.mock('@service-sync/client', () => ({
  syncServiceClient: { exists: vi.fn(), initializeFromSnapshot: vi.fn() },
}));

const disposers: (() => void)[] = [];
const context = {
  syncService: true,
  fromCache: false,
  documentMetadata: {
    documentId: 'canvas-1',
    documentName: 'Shared canvas',
    documentVersionId: 1,
    owner: 'alice',
    fileType: 'canvas',
  },
} as const;
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.resetAllMocks();
});

function open() {
  return createRoot((dispose) => {
    disposers.push(dispose);
    const [userId, setUserId] = createSignal<string | undefined>('alice');
    return { ...canvasSyncSource('canvas-1', userId), setUserId };
  });
}
function connectedAuthorization(): DocumentSyncAuthorization {
  const value = vi.mocked(createSyncServiceSource).mock.calls.at(-1)?.[2];
  if (!value) throw new Error('Missing captured authorization');
  return value;
}

it('refreshes web access on reconnect and fences an old source after account changes', async () => {
  vi.mocked(fetchFileDocumentOpenContext).mockResolvedValue(
    ok({
      ...context,
      userAccessLevel: 'edit',
      token: 'initial',
    })
  );
  const sync = open();
  await sync.authorize?.();
  sync.connect();
  const authorization = connectedAuthorization();
  expect(await authorization.getToken()).toBe('initial');
  expect(authorization.canWrite()).toBe(true);
  vi.mocked(fetchFileDocumentOpenContext).mockResolvedValue(
    err([{ code: 'INVALID', message: 'Network unavailable' }])
  );
  await expect(authorization.getToken()).rejects.toThrow('Network unavailable');
  expect(sync.canWrite()).toBe(true);
  vi.mocked(fetchFileDocumentOpenContext).mockResolvedValue(
    ok({
      ...context,
      userAccessLevel: 'comment',
      token: 'refreshed',
    })
  );
  expect(await authorization.getToken()).toBe('refreshed');
  expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(2);
  expect(authorization.canWrite()).toBe(false);
  expect(sync.canWrite()).toBe(false);
  const invalidated = vi.fn();
  authorization.onInvalidated(invalidated);
  sync.setUserId('bob');
  expect(authorization.isCurrent()).toBe(false);
  expect(invalidated).toHaveBeenCalledOnce();
  sync.setUserId('alice');
  expect(authorization.isCurrent()).toBe(false);
});

it('uses the native grant and disables edits when fresh authorization is downgraded', async () => {
  let writable = true;
  const captured: DocumentSyncAuthorization = {
    getToken: async () => 'native-token',
    canWrite: () => writable,
    isCurrent: () => true,
    onInvalidated: () => () => {},
  };
  vi.mocked(fetchFileDocumentOpenContext).mockResolvedValue(
    ok({
      ...context,
      userAccessLevel: 'edit',
      authorization: captured,
    })
  );
  const sync = open();
  await sync.authorize?.();
  sync.connect();
  const authorization = connectedAuthorization();
  expect(await authorization.getToken()).toBe('native-token');
  expect(sync.canWrite()).toBe(true);
  writable = false;
  await authorization.getToken();
  expect(sync.canWrite()).toBe(false);
  expect(authorization.canWrite()).toBe(false);
});
