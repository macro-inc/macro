import { createRoot } from 'solid-js';
import { beforeEach, expect, it, vi } from 'vitest';
import { createDatabaseDocumentNavigation } from './navigation-adapter';

const { openWithSplit, getItemPreview, isTouchDevice } = vi.hoisted(() => ({
  openWithSplit: vi.fn(),
  getItemPreview: vi.fn(),
  isTouchDevice: vi.fn(() => false),
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit }),
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice }));
vi.mock('@queries/preview', async (original) => ({
  ...(await original<typeof import('@queries/preview')>()),
  getItemPreview,
}));
beforeEach(() => {
  vi.clearAllMocks();
  isTouchDevice.mockReturnValue(false);
});

it.each(['md', 'pdf', 'png'] as const)(
  'opens a %s file beside the database after resolving its type',
  async (fileType) => {
    getItemPreview.mockResolvedValue({
      loading: false,
      access: 'access',
      fileType,
    });
    createRoot((dispose) => {
      createDatabaseDocumentNavigation()('file-id');
      dispose();
    });
    await vi.waitFor(() => expect(openWithSplit).toHaveBeenCalledOnce());
    expect(getItemPreview).toHaveBeenCalledWith({
      type: 'document',
      id: 'file-id',
    });
    expect(openWithSplit).toHaveBeenCalledWith(
      { type: fileType === 'png' ? 'image' : fileType, id: 'file-id' },
      { preferNewSplit: true }
    );
  }
);

it.each(['no_access', 'does_not_exist'])(
  'does not navigate for a %s reference',
  async (access) => {
    getItemPreview.mockResolvedValue({ loading: false, access });
    createRoot((dispose) => {
      createDatabaseDocumentNavigation()('file-id');
      dispose();
    });
    await getItemPreview.mock.results[0].value;
    expect(openWithSplit).not.toHaveBeenCalled();
  }
);

it('uses forward navigation on touch', async () => {
  isTouchDevice.mockReturnValue(true);
  getItemPreview.mockResolvedValue({
    loading: false,
    access: 'access',
    fileType: 'md',
  });
  createRoot((dispose) => {
    createDatabaseDocumentNavigation()('file-id');
    dispose();
  });
  await vi.waitFor(() => expect(openWithSplit).toHaveBeenCalledOnce());
  expect(openWithSplit).toHaveBeenCalledWith(
    { type: 'md', id: 'file-id' },
    { preferNewSplit: false }
  );
});
