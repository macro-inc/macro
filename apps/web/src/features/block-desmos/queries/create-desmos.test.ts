import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  createDocument: vi.fn(),
  upload: vi.fn(),
}));

vi.mock('@app/lib/analytics', () => ({
  analytics: { track: vi.fn() },
}));
vi.mock('@core/util/hash', () => ({
  contentHash: async () => 'sha-desmos',
}));
vi.mock('@queries/auth', () => ({ invalidateUserQuota: vi.fn() }));
vi.mock('@queries/history/history', () => ({
  postNewHistoryItem: vi.fn(),
}));
vi.mock('@queries/preview/preview', () => ({
  setPreviewOnCreate: vi.fn(),
}));
vi.mock('@queries/soup/cache', () => ({ refetchSoupEntity: vi.fn() }));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { createDocument: storage.createDocument },
}));
vi.mock('@service-storage/util/uploadToPresignedUrl', () => ({
  uploadToPresignedUrl: storage.upload,
}));

import { createDesmosDocument } from './create-desmos';

describe('createDesmosDocument', () => {
  beforeEach(() => {
    storage.createDocument.mockReset();
    storage.upload.mockReset();
  });

  it('creates a document and uploads an empty graph', async () => {
    storage.createDocument.mockResolvedValue(
      ok({
        presignedUrl: 'https://upload.example/desmos',
        metadata: { documentId: 'graph-1' },
      })
    );
    storage.upload.mockResolvedValue(ok({}));

    await expect(
      createDesmosDocument({ title: 'Parabola', source: 'command' })
    ).resolves.toBe('graph-1');
    expect(storage.createDocument).toHaveBeenCalledWith({
      documentName: 'Parabola',
      fileType: 'desmos',
      sha: 'sha-desmos',
      projectId: undefined,
    });
    expect(storage.upload).toHaveBeenCalledWith(
      expect.objectContaining({
        presignedUrl: 'https://upload.example/desmos',
        type: 'application/x-macro-desmos',
      })
    );
  });

  it('returns undefined when create fails', async () => {
    storage.createDocument.mockResolvedValue(
      err([{ code: 'UNAUTHORIZED', message: 'no' }])
    );
    await expect(createDesmosDocument({})).resolves.toBeUndefined();
    expect(storage.upload).not.toHaveBeenCalled();
  });
});
