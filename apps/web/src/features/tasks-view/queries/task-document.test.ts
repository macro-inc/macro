import type { DocumentMetadata } from '@service-storage/generated/schemas/documentMetadata';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadTaskDocument } from './task-document';

const mocks = vi.hoisted(() => ({
  fetchBundle: vi.fn(),
  fetchLocation: vi.fn(),
  waitForSync: vi.fn(),
  createSource: vi.fn(),
}));

vi.mock('@queries/storage/document-location', () => ({
  fetchDocumentLocation: mocks.fetchLocation,
  waitForDocumentSyncServiceReady: mocks.waitForSync,
}));

vi.mock('@queries/storage/documentLoad/documentLoadBundle', () => ({
  fetchDocumentLoadBundle: mocks.fetchBundle,
}));

vi.mock('@service-sync/source', () => ({
  createSyncServiceSource: mocks.createSource,
}));

const metadata = {
  documentId: 'task-1',
  documentName: 'A task',
} as DocumentMetadata;

const readyLocation = {
  type: 'syncServiceContent',
  content: { state: 'ready' },
};

describe('loadTaskDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchLocation.mockResolvedValue(ok(readyLocation));
    mocks.createSource.mockReturnValue({
      source: { status: vi.fn() },
      doInitialSync: vi.fn(),
    });
  });

  it('loads a sync source and maps edit access', async () => {
    mocks.fetchBundle.mockResolvedValue(
      ok({
        documentMetadata: metadata,
        token: 'token',
        userAccessLevel: 'edit',
      })
    );

    const result = await loadTaskDocument('task-1');

    expect(mocks.createSource).toHaveBeenCalledWith('task-1', 'token');
    expect(result.metadata).toBe(metadata);
    expect(result.permissions).toEqual({
      canComment: true,
      canEdit: true,
      isOwner: false,
    });
  });

  it('rejects when metadata cannot be loaded', async () => {
    mocks.fetchBundle.mockResolvedValue(err([{ code: 'MISSING' }]));

    await expect(loadTaskDocument('task-1')).rejects.toThrow(
      'Unable to load task metadata'
    );
    expect(mocks.createSource).not.toHaveBeenCalled();
  });
});
