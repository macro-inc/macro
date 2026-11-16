import { ok } from 'neverthrow';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const mocks = vi.hoisted(() => ({
  rustEngine: false,
  flagHandlers: [] as unknown[],
  fetchContext: vi.fn(),
  createSyncServiceSource: vi.fn(),
}));

vi.mock('@app/lib/analytics', () => ({
  analytics: {
    posthog: {
      // PostHog with no flags loaded yet (cold start, or never initialized in DEV).
      isFeatureEnabled: () => undefined,
      onFeatureFlags: (handler: unknown) => {
        mocks.flagHandlers.push(handler);
        return () => {};
      },
    },
  },
}));
vi.mock('@core/document-session/engine-selection', () => ({
  get RUST_EDITOR_ENGINE() {
    return mocks.rustEngine;
  },
}));
vi.mock('@queries/storage/documentLoad/sync-document-context', () => ({
  fetchSyncDocumentOpenContext: mocks.fetchContext,
}));
// jsdom's Blob cannot be hashed; the block's placeholder file is not under test.
vi.mock('@service-storage/util/makeFileFromBlob', () => ({
  makeFileFromBlob: async () => ({}),
}));
vi.mock('@service-sync/source', () => ({
  createSyncServiceSource: mocks.createSyncServiceSource,
}));

const context = {
  token: 'token',
  authorization: {},
  documentMetadata: {
    documentId: 'doc-1',
    documentVersionId: 1,
    documentName: 'Doc',
    owner: 'owner-1',
  },
  userAccessLevel: 'edit',
  fromCache: false,
};

// The block definition pulls in the block registry; load it once, before fake timers.
let definition: typeof import('../definition').definition;
let loadMarkdownDocument: typeof import('./markdown-document').loadMarkdownDocument;
beforeAll(async () => {
  await import('@core/constant/allBlocks');
  ({ definition } = await import('../definition'));
  ({ loadMarkdownDocument } = await import('./markdown-document'));
}, 120_000);

beforeEach(() => {
  vi.useFakeTimers();
  mocks.rustEngine = false;
  mocks.flagHandlers = [];
  mocks.fetchContext.mockResolvedValue(ok(context));
  mocks.createSyncServiceSource.mockReturnValue({
    source: 'sync-source',
    doInitialSync: 'initial-sync',
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('markdown document loading with the rust-editor-model flag off', () => {
  it('opens the legacy sync source without waiting for PostHog flags', async () => {
    const loaded = loadMarkdownDocument('doc-1');
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.fetchContext).toHaveBeenCalledWith('doc-1');
    expect(mocks.flagHandlers).toEqual([]);
    const data = await loaded;
    expect(data.connection.type).toBe('sync');
    expect(mocks.createSyncServiceSource).toHaveBeenCalledTimes(1);
  });

  it('loads the md block without waiting for PostHog flags', async () => {
    const loaded = definition.load(
      { type: 'sync-service', id: 'doc-1' },
      'initial'
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.fetchContext).toHaveBeenCalledWith('doc-1');
    expect(mocks.flagHandlers).toEqual([]);
    const result = await loaded;
    expect(result.isOk()).toBe(true);
    expect(mocks.createSyncServiceSource).toHaveBeenCalledTimes(1);
  });

  it('selects the session connection from the boot engine choice', async () => {
    mocks.rustEngine = true;
    const data = await loadMarkdownDocument('doc-1');

    expect(data.connection.type).toBe('session');
    expect(mocks.createSyncServiceSource).not.toHaveBeenCalled();
    expect(mocks.flagHandlers).toEqual([]);
  });
});
