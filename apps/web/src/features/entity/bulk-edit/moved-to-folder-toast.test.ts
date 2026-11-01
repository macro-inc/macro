import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  toast: { success: vi.fn(() => 7), dismiss: vi.fn() },
  openFolder: vi.fn(),
  isTouchDevice: vi.fn(() => false),
  canAppendSplit: vi.fn(() => true),
}));

vi.mock('@core/component/Toast/Toast', () => ({ toast: mocks.toast }));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: mocks.isTouchDevice,
}));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => ({ canAppendSplit: mocks.canAppendSplit }),
}));
vi.mock('@components/app/split-layout/open-folders', () => ({
  openFolder: mocks.openFolder,
}));

import { toastMovedToFolder } from './moved-to-folder-toast';

type Action = { label: string; onClick: () => void };

const shownToast = () => {
  const [message, options] = mocks.toast.success.mock.lastCall as unknown as [
    string,
    { actions: Action[] },
  ];
  return { message, actions: options.actions };
};

describe('toastMovedToFolder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTouchDevice.mockReturnValue(false);
    mocks.canAppendSplit.mockReturnValue(true);
  });

  it('names the count only for several items', () => {
    toastMovedToFolder(1, 'folder');
    expect(shownToast().message).toBe('Moved to folder');
    toastMovedToFolder(3, 'folder');
    expect(shownToast().message).toBe('Moved 3 items');
  });

  it('offers both opens on desktop, dismissing before it opens', () => {
    toastMovedToFolder(1, 'folder');
    const [open, openInNewSplit] = shownToast().actions;
    expect(open?.label).toBe('Open');
    expect(openInNewSplit?.label).toBe('Open in new split');

    open?.onClick();
    expect(mocks.toast.dismiss).toHaveBeenCalledWith(7);
    expect(mocks.openFolder).toHaveBeenLastCalledWith(
      expect.anything(),
      'folder',
      { newSplit: false }
    );

    openInNewSplit?.onClick();
    expect(mocks.openFolder).toHaveBeenLastCalledWith(
      expect.anything(),
      'folder',
      { newSplit: true }
    );
  });

  it('offers only Open on a touch device, which has no splits', () => {
    mocks.isTouchDevice.mockReturnValue(true);
    toastMovedToFolder(1, 'folder');
    expect(shownToast().actions.map(({ label }) => label)).toEqual(['Open']);
  });

  it('offers only Open when no split fits', () => {
    mocks.canAppendSplit.mockReturnValue(false);
    toastMovedToFolder(1, 'folder');
    expect(shownToast().actions.map(({ label }) => label)).toEqual(['Open']);
  });
});
