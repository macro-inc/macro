/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getImageDimensionsMock,
  getVideoDimensionsMock,
  toastFailureMock,
  toastAlertMock,
} = vi.hoisted(() => ({
  getImageDimensionsMock: vi.fn(),
  getVideoDimensionsMock: vi.fn(),
  toastFailureMock: vi.fn(),
  toastAlertMock: vi.fn(),
}));

vi.mock('@core/constant/allBlocks', () => ({
  fileTypeToBlockName: (type?: string | null) => type ?? 'unknown',
}));

vi.mock('@core/util/media', () => ({
  getImageDimensions: getImageDimensionsMock,
  getVideoDimensions: getVideoDimensionsMock,
}));

import { createInputAttachmentTracker } from '../attachment-tracker';
import { uploadInputAttachments } from '../upload-attachments';
import { getAttachmentKindFromFile } from '../utils/file-helpers';

vi.mock('@core/component/Toast/Toast', () => ({
  toast: {
    failure: toastFailureMock,
    alert: toastAlertMock,
  },
}));

describe('uploadInputAttachments', () => {
  beforeEach(() => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:attachment-preview');
    getImageDimensionsMock.mockReset();
    getImageDimensionsMock.mockResolvedValue({ width: 0, height: 0 });
    getVideoDimensionsMock.mockReset();
    getVideoDimensionsMock.mockResolvedValue({ width: 0, height: 0 });
    toastFailureMock.mockReset();
    toastAlertMock.mockReset();
  });

  afterEach(() => vi.restoreAllMocks());

  it('infers attachment kind from mime type and extension', () => {
    expect(
      getAttachmentKindFromFile({
        name: 'image.png',
        type: '',
      } as File)
    ).toBe('image');
    expect(
      getAttachmentKindFromFile({
        name: 'clip.mov',
        type: '',
      } as File)
    ).toBe('video');
    expect(
      getAttachmentKindFromFile({
        name: 'spec.md',
        type: '',
      } as File)
    ).toBe('document');
  });

  it('keeps the attachment pending until the upload promise resolves', async () => {
    const tracker = createInputAttachmentTracker();
    const file = new File(['abc'], 'image.png', { type: 'image/png' });
    let resolveUpload:
      | ((result: { failed: false; destination: 'static'; id: string }) => void)
      | undefined;

    const uploadPromise = uploadInputAttachments({
      files: [file],
      tracker,
      uploadFile: () =>
        new Promise((resolve) => {
          resolveUpload = resolve;
        }),
    });

    await Promise.resolve();
    expect(tracker.attachments()).toEqual([
      {
        id: expect.any(String),
        name: 'image.png',
        kind: 'image',
        pending: true,
        previewSrc: 'blob:attachment-preview',
        mimeType: 'image/png',
        size: 3,
      },
    ]);

    resolveUpload?.({
      failed: false,
      destination: 'static',
      id: 'uploaded-image-1',
    });
    await uploadPromise;

    expect(tracker.attachments()).toEqual([
      {
        id: 'uploaded-image-1',
        name: 'image.png',
        kind: 'image',
        mimeType: 'image/png',
        size: 3,
        previewSrc: 'blob:attachment-preview',
      },
    ]);
  });

  it.each([
    {
      kind: 'image' as const,
      name: 'image.png',
      mimeType: 'image/png',
      uploadedId: 'uploaded-image-1',
      getDimensionsMock: getImageDimensionsMock,
    },
    {
      kind: 'video' as const,
      name: 'clip.mp4',
      mimeType: 'video/mp4',
      uploadedId: 'uploaded-video-1',
      getDimensionsMock: getVideoDimensionsMock,
    },
  ])('keeps $kind pending until dimensions are ready', async (media) => {
    const tracker = createInputAttachmentTracker();
    const file = new File(['abc'], media.name, { type: media.mimeType });
    let resolveDimensions:
      | ((dimensions: { width: number; height: number }) => void)
      | undefined;

    media.getDimensionsMock.mockReturnValue(
      new Promise((resolve) => {
        resolveDimensions = resolve;
      })
    );

    let completed = false;
    const uploadPromise = uploadInputAttachments({
      files: [file],
      tracker,
      uploadFile: async () => ({
        failed: false,
        destination: 'static',
        id: media.uploadedId,
      }),
    }).then(() => {
      completed = true;
    });

    await vi.waitFor(() => {
      expect(media.getDimensionsMock).toHaveBeenCalledOnce();
    });

    expect(completed).toBe(false);
    expect(tracker.hasPending()).toBe(true);

    resolveDimensions?.({ width: 1920, height: 1080 });
    await uploadPromise;

    expect(tracker.attachments()).toEqual([
      {
        id: media.uploadedId,
        name: media.name,
        kind: media.kind,
        mimeType: media.mimeType,
        size: 3,
        width: 1920,
        height: 1080,
        previewSrc: 'blob:attachment-preview',
      },
    ]);
  });

  it('removes pending attachment and shows toast on failed upload', async () => {
    const tracker = createInputAttachmentTracker();
    const file = new File(['abc'], 'spec.md', { type: 'text/markdown' });

    await uploadInputAttachments({
      files: [file],
      tracker,
      uploadFile: async () => ({
        failed: true,
      }),
    });

    expect(tracker.attachments()).toEqual([]);
    expect(toastFailureMock).toHaveBeenCalledWith('Failed to upload spec.md');
  });

  it('stores document icon type from upload result', async () => {
    const tracker = createInputAttachmentTracker();
    const file = new File(['abc'], 'manual.pdf', {
      type: 'application/pdf',
    });

    await uploadInputAttachments({
      files: [file],
      tracker,
      uploadFile: async () => ({
        failed: false,
        destination: 'dss',
        type: 'document',
        documentId: 'doc-1',
        fileType: 'pdf',
      }),
    });

    expect(tracker.attachments()).toEqual([
      {
        id: 'doc-1',
        name: 'manual',
        kind: 'document',
        iconType: 'pdf',
        mimeType: 'application/pdf',
        size: 3,
      },
    ]);
  });

  it('skips a file that is already attached and tells the user', async () => {
    const tracker = createInputAttachmentTracker();
    const upload = vi.fn(async () => ({
      failed: false as const,
      destination: 'static' as const,
      id: 'uploaded-video-1',
    }));
    const clip = () => new File(['abc'], 'clip.mp4', { type: 'video/mp4' });

    await uploadInputAttachments({
      files: [clip()],
      tracker,
      uploadFile: upload,
    });
    await uploadInputAttachments({
      files: [clip()],
      tracker,
      uploadFile: upload,
    });

    expect(upload).toHaveBeenCalledOnce();
    expect(tracker.attachments()).toHaveLength(1);
    expect(toastAlertMock).toHaveBeenCalledWith('clip.mp4 is already attached');
  });

  it('skips the twin when the same file is picked twice in one batch', async () => {
    const tracker = createInputAttachmentTracker();
    const upload = vi.fn(async () => ({
      failed: false as const,
      destination: 'static' as const,
      id: `uploaded-${upload.mock.calls.length}`,
    }));
    const clip = () => new File(['abc'], 'clip.mp4', { type: 'video/mp4' });

    await uploadInputAttachments({
      files: [clip(), clip()],
      tracker,
      uploadFile: upload,
    });

    expect(upload).toHaveBeenCalledOnce();
    expect(tracker.attachments()).toHaveLength(1);
  });

  it('still allows a different file that shares a name', async () => {
    const tracker = createInputAttachmentTracker();
    const upload = vi.fn(async () => ({
      failed: false as const,
      destination: 'static' as const,
      id: `uploaded-${upload.mock.calls.length}`,
    }));

    await uploadInputAttachments({
      files: [
        new File(['abc'], 'clip.mp4', { type: 'video/mp4' }),
        new File(['abcdef'], 'clip.mp4', { type: 'video/mp4' }),
      ],
      tracker,
      uploadFile: upload,
    });

    expect(upload).toHaveBeenCalledTimes(2);
    expect(tracker.attachments()).toHaveLength(2);
    expect(toastAlertMock).not.toHaveBeenCalled();
  });

  it('recognises an uploaded document whose chip name dropped the extension', async () => {
    const tracker = createInputAttachmentTracker();
    const upload = vi.fn(async () => ({
      failed: false as const,
      destination: 'dss' as const,
      type: 'document' as const,
      documentId: 'doc-1',
      fileType: 'pdf',
    }));
    const manual = () =>
      new File(['abc'], 'manual.pdf', { type: 'application/pdf' });

    await uploadInputAttachments({
      files: [manual()],
      tracker,
      uploadFile: upload,
    });
    await uploadInputAttachments({
      files: [manual()],
      tracker,
      uploadFile: upload,
    });

    expect(upload).toHaveBeenCalledOnce();
    expect(tracker.attachments()).toEqual([
      expect.objectContaining({ id: 'doc-1', name: 'manual' }),
    ]);
  });
});
