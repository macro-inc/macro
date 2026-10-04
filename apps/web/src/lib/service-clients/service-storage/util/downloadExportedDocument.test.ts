import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadExportedDocument } from './downloadExportedDocument';

const mocks = vi.hoisted(() => ({
  exportDocument: vi.fn(),
  platformFetch: vi.fn(),
}));
vi.mock('../client', () => ({
  storageServiceClient: { exportDocument: mocks.exportDocument },
}));
vi.mock('@core/util/platformFetch', () => ({
  platformFetch: mocks.platformFetch,
}));

const docx = new Uint8Array([80, 75, 3, 4, 20, 0]);

describe('downloadExportedDocument', () => {
  beforeEach(() => {
    mocks.exportDocument.mockReset();
    mocks.platformFetch.mockReset();
  });

  it('downloads the exported file bytes from the presigned URL', async () => {
    mocks.exportDocument.mockResolvedValue(
      ok({ presigned_url: 'https://bucket/export.docx' })
    );
    mocks.platformFetch.mockResolvedValue(new Response(docx));
    const bytes = await downloadExportedDocument({ documentId: 'doc' });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes).toEqual(docx);
    expect(mocks.exportDocument).toHaveBeenCalledWith({ documentId: 'doc' });
    expect(mocks.platformFetch).toHaveBeenCalledWith(
      'https://bucket/export.docx',
      undefined
    );
  });

  it('fails when the export or the download fails', async () => {
    mocks.exportDocument.mockResolvedValueOnce(
      err([{ code: 'SERVER_ERROR', message: 'boom' }])
    );
    await expect(
      downloadExportedDocument({ documentId: 'doc' })
    ).rejects.toThrow('Unable to export the document.');
    mocks.exportDocument.mockResolvedValueOnce(
      ok({ presigned_url: 'https://bucket/export.docx' })
    );
    mocks.platformFetch.mockResolvedValueOnce(
      new Response('', { status: 403 })
    );
    await expect(
      downloadExportedDocument({ documentId: 'doc' })
    ).rejects.toThrow('Unable to download the exported document');
  });
});
