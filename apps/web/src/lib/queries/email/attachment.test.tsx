import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok, type Result } from 'neverthrow';
import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUploadDraftAttachmentsMutation } from './attachment';

const addDraftAttachmentMock = vi.hoisted(() => vi.fn());
const removeDraftAttachmentMock = vi.hoisted(() => vi.fn());
const uploadToPresignedUrlMock = vi.hoisted(() => vi.fn());
const toastFailureMock = vi.hoisted(() => vi.fn());

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
  contentHash: vi.fn(async () => 'a'.repeat(64)),
}));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: toastFailureMock },
}));

let testQueryClient: QueryClient;
let dispose: (() => void) | undefined;

function renderHook<T>(factory: () => T): T {
  let hook!: T;
  dispose = render(
    () => (
      <QueryClientProvider client={testQueryClient}>
        {(() => {
          hook = factory();
          return null as unknown as JSX.Element;
        })()}
      </QueryClientProvider>
    ),
    document.body
  );
  return hook;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

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
  testQueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  addDraftAttachmentMock.mockResolvedValue(
    ok({
      attachment_id: 'att-1',
      upload_url: 'https://bucket/att-1',
      content_type: 'application/pdf',
    })
  );
  removeDraftAttachmentMock.mockResolvedValue(ok(undefined));
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
});

describe('useUploadDraftAttachmentsMutation', () => {
  it('assigns the attachment id before the content upload completes', async () => {
    const upload = deferred<Result<void, never>>();
    uploadToPresignedUrlMock.mockReturnValue(upload.promise);
    const onAttachmentAdded = vi.fn();
    const attachment = file();

    const mutation = renderHook(() => useUploadDraftAttachmentsMutation());
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

    const mutation = renderHook(() => useUploadDraftAttachmentsMutation());
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

    const mutation = renderHook(() => useUploadDraftAttachmentsMutation());
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

    const mutation = renderHook(() => useUploadDraftAttachmentsMutation());
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
});
