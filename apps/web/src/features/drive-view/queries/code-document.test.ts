import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCodeDocument, saveCodeDocument } from './code-document';

const storageMocks = vi.hoisted(() => ({
  getTextDocument: vi.fn(),
  simpleSave: vi.fn(),
}));

vi.mock('@service-storage/client', () => ({
  storageServiceClient: storageMocks,
}));

describe('code document queries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads text, metadata, and access together', async () => {
    const data = {
      text: 'const answer = 42;',
      documentMetadata: {
        documentId: 'document-1',
        documentName: 'answer',
        fileType: 'ts',
      },
      userAccessLevel: 'edit',
    };
    storageMocks.getTextDocument.mockResolvedValue(ok(data));

    await expect(loadCodeDocument('document-1')).resolves.toEqual(data);
    expect(storageMocks.getTextDocument).toHaveBeenCalledWith({
      documentId: 'document-1',
    });
  });

  it('surfaces load failures for the detail retry boundary', async () => {
    storageMocks.getTextDocument.mockResolvedValue(
      err([{ code: 'NOT_FOUND', message: 'missing' }])
    );

    await expect(loadCodeDocument('missing')).rejects.toThrow('missing');
  });

  it('persists edited text through simple save', async () => {
    storageMocks.simpleSave.mockResolvedValue(ok({}));

    await saveCodeDocument('document-1', 'updated');

    expect(storageMocks.simpleSave).toHaveBeenCalledOnce();
    const request = storageMocks.simpleSave.mock.calls[0]?.[0];
    expect(request.documentId).toBe('document-1');
    expect(request.file.type).toBe('text/plain');
    const fileText = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => resolve(String(reader.result)));
      reader.addEventListener('error', () => reject(reader.error));
      reader.readAsText(request.file);
    });
    expect(fileText).toBe('updated');
  });
});
