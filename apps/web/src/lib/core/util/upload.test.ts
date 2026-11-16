import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dssUpload: vi.fn(),
  toastFailure: vi.fn(),
}));
vi.mock('@app/lib/analytics', () => ({ analytics: { track: vi.fn() } }));
vi.mock('@core/client/zipWorkerClient', () => ({
  DirectoryFileCountExceededError: class extends Error {},
  DirectoryFileSizeExceededError: class extends Error {},
  handleFoldersInput: vi.fn(),
  zipFiles: vi.fn(),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn(), failure: mocks.toastFailure },
}));
vi.mock('@core/heic/service', () => ({
  heicConversionService: { canConvert: () => false },
}));
vi.mock('@core/mobile/nativeStagedUpload', () => ({
  getNativeStagedUpload: () => undefined,
}));
vi.mock('@queries/auth', () => ({ invalidateUserQuota: async () => {} }));
vi.mock('@service-storage/util/upload', () => ({
  DocumentNameTooLongError: class extends Error {},
  upload: mocks.dssUpload,
}));

import { uploadFiles } from './upload';

function sized(name: string, type: string, size: number) {
  const file = new File([], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.dssUpload.mockImplementation(async (file: File) => ({
    type: 'folder',
    name: file.name,
    requestId: 'request',
    projectId: Promise.resolve('project'),
  }));
});

it('uploads a folder zip larger than the single-file limit', async () => {
  const zip = sized('Archive.zip', 'application/zip', 2_500_000_000);

  const [result] = await uploadFiles([{ file: zip, isFolder: true }], 'dss');

  expect(result.failed).toBe(false);
  expect(mocks.dssUpload).toHaveBeenCalledWith(
    zip,
    expect.objectContaining({ unzipFolder: true })
  );
});

it('still refuses a single file larger than 2 GB', async () => {
  const pdf = sized('Scan.pdf', 'application/pdf', 2_500_000_000);

  await expect(uploadFiles([pdf], 'dss')).rejects.toThrow(
    'exceeds the size limit of 2 GB'
  );
  expect(mocks.dssUpload).not.toHaveBeenCalled();
});
