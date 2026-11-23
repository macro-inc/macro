import { describe, expect, it, vi } from 'vitest';
import { createSyncDocumentStorage } from './sync-document';

describe('createSyncDocumentStorage', () => {
  it('reports a state response without a snapshot as invalid, not too large', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ revision: 'AQID' }));
    const storage = createSyncDocumentStorage(
      'https://sync.example',
      'doc',
      'scoped-token',
      fetcher
    );

    await expect(
      storage.load(new AbortController().signal)
    ).rejects.toMatchObject({ failure: 'invalid_response', status: 502 });
  });
});
