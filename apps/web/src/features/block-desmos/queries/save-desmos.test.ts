import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyDesmosDocument } from '../core/document';
import { saveDesmosDocument } from './save-desmos';

const storage = vi.hoisted(() => ({ simpleSave: vi.fn() }));

vi.mock('@service-storage/client', () => ({
  storageServiceClient: storage,
}));

describe('saveDesmosDocument', () => {
  beforeEach(() => {
    storage.simpleSave.mockReset();
  });

  it('writes version 1 JSON through simpleSave', async () => {
    storage.simpleSave.mockResolvedValue(ok({}));
    const document = emptyDesmosDocument();
    const result = await saveDesmosDocument('graph-1', document);
    expect(result.saved).toBe(true);
    expect(result.file.type).toBe('application/x-macro-desmos');
    expect(storage.simpleSave).toHaveBeenCalledWith({
      documentId: 'graph-1',
      file: result.file,
    });
  });
});
