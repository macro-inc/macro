import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { uploadFile, makePresignedUrl } = vi.hoisted(() => ({
  uploadFile: vi.fn(),
  makePresignedUrl: vi.fn(),
}));
vi.mock('@core/constant/allBlocks', () => ({
  fileTypeToBlockName: (type: string) => type,
}));
vi.mock('@core/util/upload', () => ({ uploadFile, chatRuleset: {} }));

import { createInputAttachmentTracker } from '@channel/Input/attachment-tracker';
import { getNativeStagedUpload } from '@core/mobile/nativeStagedUpload';
import type { PendingShareFile } from '@macro/tauri';
import { uploadPendingShareAttachment } from './uploadPendingShareAttachment';

const file: PendingShareFile = {
  token: 'share-stage-fixture',
  name: 'photo.png',
  mimeType: 'image/png',
  size: 32 * 1024 * 1024,
  sha256: 'ab'.repeat(32),
  previewSrc: 'asset://fixture',
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  makePresignedUrl.mockResolvedValue({
    id: 'static-fixture',
    upload_url: 'https://example.com/upload',
  });
});
afterEach(() => vi.restoreAllMocks());

it('reports a failed native upload and can retry it without duplicate attachments', async () => {
  const tracker = createInputAttachmentTracker();
  const nativeUpload = vi
    .fn()
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValueOnce(undefined);
  const options = {
    file,
    tracker,
    prepareMedia: makePresignedUrl,
    uploadPendingShareFile: nativeUpload,
    isActive: () => true,
  };
  expect(await uploadPendingShareAttachment(options)).toBe(false);
  expect(tracker.attachments()).toEqual([]);
  expect(await uploadPendingShareAttachment(options)).toBe(true);
  expect(tracker.attachments()).toEqual([
    expect.objectContaining({
      id: 'static-fixture',
      name: file.name,
      size: file.size,
    }),
  ]);
});

it('keeps the file pending until native bytes finish uploading', async () => {
  const tracker = createInputAttachmentTracker();
  let finish: (() => void) | undefined;
  const nativeUpload = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  const result = uploadPendingShareAttachment({
    file,
    tracker,
    prepareMedia: makePresignedUrl,
    uploadPendingShareFile: nativeUpload,
    isActive: () => true,
  });
  await vi.waitFor(() => expect(nativeUpload).toHaveBeenCalledOnce());
  expect(tracker.hasPending()).toBe(true);
  finish?.();
  expect(await result).toBe(true);
  expect(tracker.hasPending()).toBe(false);
});

it('preserves document staging metadata instead of uploading an empty placeholder', async () => {
  const tracker = createInputAttachmentTracker();
  uploadFile.mockResolvedValue({
    failed: false,
    destination: 'dss',
    type: 'document',
    documentId: 'doc-fixture',
    fileType: 'pdf',
  });
  expect(
    await uploadPendingShareAttachment({
      file: { ...file, name: 'manual.pdf', mimeType: 'application/pdf' },
      tracker,
      prepareMedia: makePresignedUrl,
      uploadPendingShareFile: vi.fn(),
      isActive: () => true,
    })
  ).toBe(true);
  const uploaded = uploadFile.mock.calls[0][0];
  expect(getNativeStagedUpload(uploaded)).toMatchObject({
    token: file.token,
    size: file.size,
    sha256: file.sha256,
  });
  expect(tracker.attachments()).toEqual([
    expect.objectContaining({
      id: 'doc-fixture',
      kind: 'document',
      size: file.size,
    }),
  ]);
});
