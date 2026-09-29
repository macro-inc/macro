import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  createDocument: vi.fn(),
  deleteDocument: vi.fn(),
  browserPut: vi.fn(),
  ready: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
  convertFileSrc: (path: string) => path,
}));
vi.mock('@app/lib/analytics', () => ({ analytics: { track: vi.fn() } }));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn(), failure: vi.fn() },
  createUploadToast: vi.fn(),
}));
vi.mock('@core/constant/allBlocks', () => ({
  blockAcceptedMimetypeToFileExtension: { 'application/pdf': 'pdf' },
}));
vi.mock('@core/constant/PaywallState', () => ({
  usePaywallState: () => ({ showPaywall: vi.fn() }),
  PaywallKey: {},
}));
vi.mock('@kobalte/core/toast', () => ({ toaster: { dismiss: vi.fn() } }));
vi.mock('@queries/storage/document-location', () => ({
  waitForDocumentContentReady: mocks.ready,
}));
vi.mock('@service-connection/bulkUpload', () => ({
  waitBulkUploadStatus: vi.fn(),
}));
vi.mock('@service-storage/client', () => ({
  DOCUMENT_NAME_TOO_LONG_CODE: 'name-too-long',
  storageServiceClient: {
    createDocument: mocks.createDocument,
    deleteDocument: mocks.deleteDocument,
  },
}));
vi.mock('@service-storage/util/uploadToPresignedUrl', () => ({
  uploadToPresignedUrl: mocks.browserPut,
}));
vi.mock('@service-storage/websocket', () => ({ storageWS: {} }));
vi.mock('./uploadDocx', () => ({ uploadDocx: vi.fn() }));

import { createNativeStagedUploadFile } from '@core/mobile/nativeStagedUpload';
import { upload } from './upload';

function stagedPdf() {
  const file = createNativeStagedUploadFile('share', {
    token: 'share-stage-test',
    name: 'manual.pdf',
    mimeType: 'application/pdf',
    size: 400_000_000,
    previewPath: null,
    sha256: 'ab'.repeat(32),
  })!;
  Object.defineProperty(file, 'arrayBuffer', {
    value: () => {
      throw new Error('Must not read the empty JS placeholder');
    },
  });
  return file;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.createDocument.mockResolvedValue(
    ok({
      metadata: { documentId: 'doc', documentVersionId: 1 },
      presignedUrl: 'https://example.com/upload',
      contentType: 'application/pdf',
      fileType: 'pdf',
    })
  );
  mocks.ready.mockResolvedValue({ content: { state: 'ready' } });
});
describe('native shared document upload', () => {
  it('uses the staged checksum and streams native bytes without reading the JS placeholder', async () => {
    const result = await upload(stagedPdf(), { hideProgressIndicator: true });
    expect(result).toMatchObject({ type: 'document', documentId: 'doc' });
    expect(mocks.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        sha: 'ab'.repeat(32),
        documentName: 'manual.pdf',
      })
    );
    expect(mocks.invoke).toHaveBeenCalledWith(
      'upload_staged_file_to_presigned_url',
      {
        source: 'share',
        token: 'share-stage-test',
        uploadUrl: 'https://example.com/upload',
        mimeType: 'application/pdf',
        checksumSha256: btoa(
          String.fromCharCode(...new Uint8Array(32).fill(171))
        ),
      }
    );
    expect(mocks.browserPut).not.toHaveBeenCalled();
    expect(mocks.deleteDocument).not.toHaveBeenCalled();
  });
  it('removes the newly created document if the native PUT fails', async () => {
    mocks.invoke.mockRejectedValue(new Error('Upload failed'));
    await expect(
      upload(stagedPdf(), { hideProgressIndicator: true })
    ).rejects.toThrow('Failed to upload file');
    expect(mocks.deleteDocument).toHaveBeenCalledWith({ documentId: 'doc' });
    expect(mocks.ready).not.toHaveBeenCalled();
  });
});
