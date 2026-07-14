/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@core/constant/allBlocks', () => ({
  fileTypeToBlockName: (type?: string | null) => type ?? 'unknown',
}));

import { createInputAttachmentTracker } from '../attachment-tracker';
import { uploadInputAttachments } from '../upload-attachments';
import { getAttachmentKindFromFile } from '../utils/file-helpers';

const { toastFailureMock } = vi.hoisted(() => {
  return {
    toastFailureMock: vi.fn(),
  };
});

vi.mock('@core/component/Toast/Toast', () => ({
  toast: {
    failure: toastFailureMock,
  },
}));

describe('uploadInputAttachments', () => {
  beforeEach(() => {
    toastFailureMock.mockReset();
  });

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
      },
    ]);
  });
});
