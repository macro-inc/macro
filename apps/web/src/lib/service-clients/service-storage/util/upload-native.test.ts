import { ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  createDocument: vi.fn(),
  deleteDocument: vi.fn(),
  browserPut: vi.fn(),
  ready: vi.fn(),
  createUploadZipRequest: vi.fn(),
  waitForFolderUpload: vi.fn(),
  folderZipSha256: vi.fn(),
  toastSuccess: vi.fn(),
  toastFailure: vi.fn(),
  toastAlert: vi.fn(),
  trackUpload: vi.fn(),
  uploadSending: vi.fn(),
  uploadProcessing: vi.fn(),
  uploadDone: vi.fn(),
  contentHash: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
  convertFileSrc: (path: string) => path,
}));
vi.mock('@app/lib/analytics', () => ({ analytics: { track: vi.fn() } }));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: {
    success: mocks.toastSuccess,
    failure: mocks.toastFailure,
    alert: mocks.toastAlert,
  },
}));
vi.mock('@core/client/zipWorkerClient', () => ({
  getFolderZipSha256: mocks.folderZipSha256,
}));
vi.mock('@core/component/UploadProgress/uploadProgress', () => ({
  trackUpload: mocks.trackUpload,
}));
vi.mock('@core/constant/allBlocks', () => ({
  blockAcceptedMimetypeToFileExtension: { 'application/pdf': 'pdf' },
}));
vi.mock('@core/constant/PaywallState', () => ({
  usePaywallState: () => ({ showPaywall: vi.fn() }),
  PaywallKey: {},
}));
vi.mock('@core/util/hash', () => ({ contentHash: mocks.contentHash }));
vi.mock('@queries/storage/document-location', () => ({
  waitForDocumentContentReady: mocks.ready,
}));
vi.mock('./folderUploadStatus', () => ({
  waitForFolderUpload: mocks.waitForFolderUpload,
}));
vi.mock('@service-storage/client', () => ({
  DOCUMENT_NAME_TOO_LONG_CODE: 'name-too-long',
  storageServiceClient: {
    createDocument: mocks.createDocument,
    deleteDocument: mocks.deleteDocument,
    projects: { createUploadZipRequest: mocks.createUploadZipRequest },
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
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.contentHash.mockResolvedValue('cd'.repeat(32));
  mocks.trackUpload.mockReturnValue({
    sending: mocks.uploadSending,
    processing: mocks.uploadProcessing,
    done: mocks.uploadDone,
  });
  mocks.browserPut.mockResolvedValue(ok(undefined));
  mocks.createUploadZipRequest.mockResolvedValue(
    ok({ presignedUrl: 'https://example.com/zip', requestId: 'zip-request' })
  );
  mocks.waitForFolderUpload.mockResolvedValue({
    status: 'completed',
    projectId: 'project',
  });
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
afterEach(() => vi.unstubAllGlobals());
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
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.contentHash).not.toHaveBeenCalled();
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

describe('pdf upload checksums', () => {
  function stagedWithoutChecksum() {
    const file = createNativeStagedUploadFile('pasteboard', {
      token: 'ios-stage-test',
      name: 'attachment.pdf',
      mimeType: 'application/pdf',
      size: 3,
      previewPath: 'https://asset.localhost/attachment',
    })!;
    Object.defineProperty(file, 'arrayBuffer', {
      value: () => {
        throw new Error('Must not read the empty JS placeholder');
      },
    });
    return file;
  }

  it('hashes staged bytes when the native source provides no checksum', async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    mocks.fetch.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => bytes,
    });

    await upload(stagedWithoutChecksum());

    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://asset.localhost/attachment'
    );
    expect(mocks.contentHash).toHaveBeenCalledWith(bytes);
    expect(mocks.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({ sha: 'cd'.repeat(32) })
    );
    expect(mocks.invoke).toHaveBeenCalledWith(
      'upload_staged_file_to_presigned_url',
      expect.objectContaining({
        token: 'ios-stage-test',
        checksumSha256: btoa(
          String.fromCharCode(...new Uint8Array(32).fill(205))
        ),
      })
    );
    expect(mocks.browserPut).not.toHaveBeenCalled();
  });

  it('clears the progress indicator and creates no upload request if staged checksum calculation fails', async () => {
    mocks.fetch.mockRejectedValue(new Error('Native bytes unavailable'));

    await expect(upload(stagedWithoutChecksum())).rejects.toThrow(
      'Native bytes unavailable'
    );

    expect(mocks.uploadDone).toHaveBeenCalledOnce();
    expect(mocks.createDocument).not.toHaveBeenCalled();
    expect(mocks.createUploadZipRequest).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.browserPut).not.toHaveBeenCalled();
  });
});

describe('browser upload checksums', () => {
  it('still hashes and uploads the original file bytes', async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const file = new File([], 'browser.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes });

    await upload(file);

    expect(mocks.contentHash).toHaveBeenCalledWith(bytes);
    expect(mocks.browserPut).toHaveBeenCalledWith({
      presignedUrl: 'https://example.com/upload',
      buffer: bytes,
      sha: 'cd'.repeat(32),
      type: 'application/pdf',
      onProgress: mocks.uploadSending,
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.trackUpload).toHaveBeenCalledWith('browser', 0);
    expect(mocks.uploadProcessing).toHaveBeenCalledOnce();
    expect(mocks.uploadDone).toHaveBeenCalledOnce();
  });

  it('clears the progress indicator if the PUT throws', async () => {
    const file = new File([], 'browser.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => new ArrayBuffer(0),
    });
    mocks.browserPut.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(upload(file)).rejects.toThrow('Failed to fetch');

    expect(mocks.uploadProcessing).not.toHaveBeenCalled();
    expect(mocks.uploadDone).toHaveBeenCalledOnce();
  });

  it('clears the progress indicator before creating a document if hashing fails', async () => {
    const file = new File([], 'browser.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => new ArrayBuffer(0),
    });
    mocks.contentHash.mockRejectedValue(new Error('Hash failed'));

    await expect(upload(file)).rejects.toThrow('Hash failed');

    expect(mocks.uploadDone).toHaveBeenCalledOnce();
    expect(mocks.createDocument).not.toHaveBeenCalled();
    expect(mocks.browserPut).not.toHaveBeenCalled();
  });
});

describe('folder uploads', () => {
  function folderZip() {
    const file = new File(['zip bytes'], 'Archive.zip', {
      type: 'application/zip',
    });
    Object.defineProperty(file, 'arrayBuffer', {
      value: () => {
        throw new Error('Must not read a folder zip into memory');
      },
    });
    return file;
  }

  it('sends the zip itself with the hash it was written with', async () => {
    const file = folderZip();
    mocks.folderZipSha256.mockReturnValue('ef'.repeat(32));

    const result = await upload(file, { unzipFolder: true });

    expect(result.type).toBe('folder');
    expect(mocks.createUploadZipRequest).toHaveBeenCalledWith({
      sha: 'ef'.repeat(32),
      name: 'Archive',
      parentId: undefined,
    });
    expect(mocks.browserPut).toHaveBeenCalledWith({
      presignedUrl: 'https://example.com/zip',
      buffer: file,
      sha: 'ef'.repeat(32),
      type: 'application/zip',
      onProgress: mocks.uploadSending,
    });
    expect(mocks.contentHash).not.toHaveBeenCalled();
  });

  it('keeps the progress indicator until the server finishes the folder', async () => {
    mocks.folderZipSha256.mockReturnValue('ef'.repeat(32));
    let finish!: (outcome: unknown) => void;
    mocks.waitForFolderUpload.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );

    const result = await upload(folderZip(), { unzipFolder: true });

    expect(mocks.uploadProcessing).toHaveBeenCalledWith(null);
    expect(mocks.uploadDone).not.toHaveBeenCalled();
    finish({ status: 'completed', projectId: 'project' });
    await vi.waitFor(() => expect(mocks.uploadDone).toHaveBeenCalledOnce());
    if (result.type !== 'folder') throw new Error('expected a folder');
    await expect(result.projectId).resolves.toBe('project');
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Uploaded Archive');
  });

  it('says it could not confirm a folder rather than that it failed', async () => {
    mocks.folderZipSha256.mockReturnValue('ef'.repeat(32));
    mocks.waitForFolderUpload.mockResolvedValue({ status: 'unknown' });

    const result = await upload(folderZip(), { unzipFolder: true });

    if (result.type !== 'folder') throw new Error('expected a folder');
    await expect(result.projectId).resolves.toBeUndefined();
    expect(mocks.toastFailure).not.toHaveBeenCalled();
    expect(mocks.toastAlert).toHaveBeenCalledWith(
      "Couldn't confirm that Archive finished uploading. Check Drive in a few minutes."
    );
  });

  it('counts the files a partial upload left behind', async () => {
    mocks.folderZipSha256.mockReturnValue('ef'.repeat(32));
    mocks.waitForFolderUpload.mockResolvedValue({
      status: 'partially_completed',
      projectId: 'project',
      progress: { filesTotal: 814, filesStored: 811, filesFailed: 3 },
    });

    const result = await upload(folderZip(), { unzipFolder: true });

    if (result.type !== 'folder') throw new Error('expected a folder');
    await expect(result.projectId).resolves.toBe('project');
    expect(mocks.toastAlert).toHaveBeenCalledWith(
      'Uploaded Archive, but 3 of 814 files could not be uploaded'
    );
  });

  it('refuses a zip the app did not prepare before asking for an upload URL', async () => {
    mocks.folderZipSha256.mockReturnValue(undefined);

    await expect(upload(folderZip(), { unzipFolder: true })).rejects.toThrow(
      'Folder was not prepared for upload'
    );

    expect(mocks.createUploadZipRequest).not.toHaveBeenCalled();
    expect(mocks.uploadDone).toHaveBeenCalledOnce();
  });
});
