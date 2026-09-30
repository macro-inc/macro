import { createNativeStagedUploadFile } from '@core/mobile/nativeStagedUpload';
import { err, ok, type Result } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUploadDraftAttachmentsMutation } from './attachment';
import { mountEmailMutation } from './tests/mutation';

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  convertFileSrc: (path: string) => `asset://${path}`,
}));

const addDraftAttachmentMock = vi.hoisted(() => vi.fn());
const removeDraftAttachmentMock = vi.hoisted(() => vi.fn());
const uploadToPresignedUrlMock = vi.hoisted(() => vi.fn());
const toastFailureMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());
const contentHashMock = vi.hoisted(() => vi.fn(async () => 'a'.repeat(64)));

vi.mock('@service-email/client', () => ({
  emailClient: {
    addDraftAttachment: addDraftAttachmentMock,
    removeDraftAttachment: removeDraftAttachmentMock,
  },
}));

vi.mock('@service-storage/util/uploadToPresignedUrl', () => ({
  uploadToPresignedUrl: uploadToPresignedUrlMock,
}));

vi.mock('@core/util/hash', () => ({
  contentHash: contentHashMock,
}));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: toastFailureMock },
}));

// jsdom's File lacks arrayBuffer()
const file = () => {
  const f = new File([new Uint8Array([1, 2, 3])], 'demo.pdf', {
    type: 'application/pdf',
  });
  Object.defineProperty(f, 'arrayBuffer', {
    value: async () => new Uint8Array([1, 2, 3]).buffer,
  });
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  addDraftAttachmentMock.mockResolvedValue(
    ok({
      attachment_id: 'att-1',
      upload_url: 'https://bucket/att-1',
      content_type: 'application/pdf',
    })
  );
  removeDraftAttachmentMock.mockResolvedValue(ok(undefined));
});
afterEach(() => vi.unstubAllGlobals());

describe('useUploadDraftAttachmentsMutation', () => {
  it('assigns the attachment id before the content upload completes', async () => {
    const upload = Promise.withResolvers<Result<void, never>>();
    uploadToPresignedUrlMock.mockReturnValue(upload.promise);
    const onAttachmentAdded = vi.fn();
    const attachment = file();

    const mutation = mountEmailMutation(useUploadDraftAttachmentsMutation);
    const pending = mutation.mutateAsync({
      draftID: 'draft-1',
      attachments: [attachment],
      onAttachmentAdded,
    });

    await vi.waitFor(() => expect(onAttachmentAdded).toHaveBeenCalled());
    expect(onAttachmentAdded).toHaveBeenCalledWith(attachment, 'att-1');

    upload.resolve(ok(undefined));
    await pending;
    expect(toastFailureMock).not.toHaveBeenCalled();
  });

  it('keeps the id when the record removal fails after a failed upload', async () => {
    uploadToPresignedUrlMock.mockResolvedValue(
      err([{ code: 'SERVER_ERROR', message: 'upload failed' }])
    );
    removeDraftAttachmentMock.mockResolvedValue(
      err([{ code: 'SERVER_ERROR', message: 'removal failed' }])
    );
    const onAttachmentUploadFailed = vi.fn();
    const attachment = file();

    const mutation = mountEmailMutation(useUploadDraftAttachmentsMutation);
    await expect(
      mutation.mutateAsync({
        draftID: 'draft-1',
        attachments: [attachment],
        onAttachmentUploadFailed,
      })
    ).rejects.toThrow('upload failed');

    expect(removeDraftAttachmentMock).toHaveBeenCalled();
    expect(onAttachmentUploadFailed).not.toHaveBeenCalled();
    expect(toastFailureMock).toHaveBeenCalledWith('Failed to save attachments');
  });

  it('removes the record and clears the id when the content upload throws', async () => {
    uploadToPresignedUrlMock.mockRejectedValue(new Error('network dropped'));
    const onAttachmentUploadFailed = vi.fn();
    const attachment = file();

    const mutation = mountEmailMutation(useUploadDraftAttachmentsMutation);
    await expect(
      mutation.mutateAsync({
        draftID: 'draft-1',
        attachments: [attachment],
        onAttachmentUploadFailed,
      })
    ).rejects.toThrow('Upload failed');

    expect(removeDraftAttachmentMock).toHaveBeenCalledWith(
      { draftID: 'draft-1', attachmentID: 'att-1' },
      undefined
    );
    expect(onAttachmentUploadFailed).toHaveBeenCalledWith(attachment);
    expect(toastFailureMock).toHaveBeenCalledWith('Failed to save attachments');
  });

  it('removes the record and clears the id when the content upload fails', async () => {
    uploadToPresignedUrlMock.mockResolvedValue(
      err([{ code: 'SERVER_ERROR', message: 'upload failed' }])
    );
    const onAttachmentAdded = vi.fn();
    const onAttachmentUploadFailed = vi.fn();
    const attachment = file();

    const mutation = mountEmailMutation(useUploadDraftAttachmentsMutation);
    await expect(
      mutation.mutateAsync({
        draftID: 'draft-1',
        attachments: [attachment],
        onAttachmentAdded,
        onAttachmentUploadFailed,
      })
    ).rejects.toThrow('upload failed');

    expect(onAttachmentAdded).toHaveBeenCalledWith(attachment, 'att-1');
    expect(removeDraftAttachmentMock).toHaveBeenCalledWith(
      { draftID: 'draft-1', attachmentID: 'att-1' },
      undefined
    );
    expect(onAttachmentUploadFailed).toHaveBeenCalledWith(attachment);
    expect(toastFailureMock).toHaveBeenCalledWith('Failed to save attachments');
  });
  it('uploads native clipboard bytes with the real size and checksum', async () => {
    const attachment = createNativeStagedUploadFile('pasteboard', {
      token: 'paste-stage-fixture',
      name: 'photo.png',
      mimeType: 'image/png',
      size: 1024,
      previewPath: null,
      sha256: 'ab'.repeat(32),
    })!;
    invokeMock.mockResolvedValue(undefined);
    const mutation = mountEmailMutation(useUploadDraftAttachmentsMutation);
    await mutation.mutateAsync({
      draftID: 'draft-1',
      attachments: [attachment],
    });
    expect(addDraftAttachmentMock).toHaveBeenCalledWith(
      {
        draftID: 'draft-1',
        attachment: {
          file_name: 'photo.png',
          size: 1024,
          sha: 'ab'.repeat(32),
        },
      },
      undefined
    );
    expect(uploadToPresignedUrlMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(invokeMock).toHaveBeenCalledWith(
      'upload_staged_file_to_presigned_url',
      {
        source: 'pasteboard',
        token: 'paste-stage-fixture',
        uploadUrl: 'https://bucket/att-1',
        mimeType: 'application/pdf',
        checksumSha256: btoa(
          String.fromCharCode(...new Uint8Array(32).fill(171))
        ),
      }
    );
  });

  it.each(['pasteboard', 'photo-library'] as const)(
    'hashes the real staged %s bytes when an older iOS plugin supplies no digest',
    async (source) => {
      const bytes = new Uint8Array([1, 2, 3]).buffer;
      fetchMock.mockResolvedValue({ ok: true, arrayBuffer: async () => bytes });
      const attachment = createNativeStagedUploadFile(source, {
        token: 'native-fixture',
        name: 'photo.png',
        mimeType: 'image/png',
        size: 3,
        previewPath: '/staging/photo.png',
      })!;
      Object.defineProperty(attachment, 'arrayBuffer', {
        value: () => {
          throw new Error('Must not hash the empty placeholder');
        },
      });
      invokeMock.mockResolvedValue(undefined);
      const mutation = mountEmailMutation(useUploadDraftAttachmentsMutation);
      await mutation.mutateAsync({
        draftID: 'draft-1',
        attachments: [attachment],
      });

      expect(fetchMock).toHaveBeenCalledWith('asset:///staging/photo.png');
      expect(contentHashMock).toHaveBeenCalledWith(bytes);
      expect(addDraftAttachmentMock).toHaveBeenCalledWith(
        {
          draftID: 'draft-1',
          attachment: { file_name: 'photo.png', size: 3, sha: 'a'.repeat(64) },
        },
        undefined
      );
      expect(invokeMock).toHaveBeenCalledWith(
        'upload_staged_file_to_presigned_url',
        {
          source,
          token: 'native-fixture',
          uploadUrl: 'https://bucket/att-1',
          mimeType: 'application/pdf',
          checksumSha256: btoa(
            String.fromCharCode(...new Uint8Array(32).fill(170))
          ),
        }
      );
      expect(uploadToPresignedUrlMock).not.toHaveBeenCalled();
    }
  );

  it.each([
    { ok: false, bytes: new Uint8Array([1, 2, 3]).buffer },
    { ok: true, bytes: new ArrayBuffer(0) },
  ])(
    'does not create a record when the staged bytes cannot be read intact: $ok',
    async ({ ok, bytes }) => {
      fetchMock.mockResolvedValue({ ok, arrayBuffer: async () => bytes });
      const attachment = createNativeStagedUploadFile('pasteboard', {
        token: 'native-fixture',
        name: 'photo.png',
        mimeType: 'image/png',
        size: 3,
        previewPath: '/staging/photo.png',
      })!;
      const mutation = mountEmailMutation(useUploadDraftAttachmentsMutation);
      await expect(
        mutation.mutateAsync({ draftID: 'draft-1', attachments: [attachment] })
      ).rejects.toThrow();
      expect(addDraftAttachmentMock).not.toHaveBeenCalled();
      expect(invokeMock).not.toHaveBeenCalled();
    }
  );
});
