import { beforeEach, expect, it, vi } from 'vitest';
import { exportAndroidFileWithProgress } from './exportAndroidFileWithProgress';

const mocks = vi.hoisted(() => ({ export: vi.fn(), dismiss: vi.fn() }));
vi.mock('./androidFiles', () => ({ exportAndroidFile: mocks.export }));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { custom: () => 1, dismiss: mocks.dismiss },
}));
beforeEach(() => vi.clearAllMocks());

it.each([10, 2 * 1024 * 1024])(
  'cancels a %i-byte native transfer when its owner closes',
  async (size) => {
    const controller = new AbortController();
    mocks.export.mockImplementation(
      (_blob, _name, _action, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener(
            'abort',
            () => reject(new DOMException('Cancelled', 'AbortError')),
            { once: true }
          );
        })
    );
    const pending = exportAndroidFileWithProgress(
      new Blob([new Uint8Array(size)]),
      'video.mp4',
      'share',
      controller.signal
    );
    controller.abort();
    await expect(pending).resolves.toEqual({ canceled: true });
    expect(mocks.export.mock.calls[0][3].signal.aborted).toBe(true);
  }
);

it('does not start a native export for an already cancelled request', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    exportAndroidFileWithProgress(
      new Blob(['video']),
      'video.mp4',
      'save',
      controller.signal
    )
  ).resolves.toEqual({ canceled: true });
  expect(mocks.export).not.toHaveBeenCalled();
});
