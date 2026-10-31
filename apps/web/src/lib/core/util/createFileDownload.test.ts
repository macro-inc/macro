import {
  createFileDownload,
  type DownloadSource,
} from '@core/util/createFileDownload';
import { err, ok } from 'neverthrow';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  touch: false,
  platform: 'web',
  save: vi.fn(),
  android: vi.fn(),
  ios: vi.fn(),
  hasIos: vi.fn(),
  custom: vi.fn(),
  success: vi.fn(),
  failure: vi.fn(),
}));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => mocks.touch,
}));
vi.mock('@core/util/platform', () => ({
  isPlatform: (platform: string) => mocks.platform === platform,
}));
vi.mock('@core/mobile/iosFiles', () => ({
  exportIosFile: mocks.ios,
  hasIosFileExport: mocks.hasIos,
}));
vi.mock('@filesystem/download', () => ({ downloadFile: mocks.save }));
vi.mock('@core/mobile/exportAndroidFileWithProgress', () => ({
  exportAndroidFileWithProgress: mocks.android,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: {
    success: mocks.success,
    failure: mocks.failure,
    custom: mocks.custom,
  },
}));

type DownloadResult = Awaited<ReturnType<DownloadSource['load']>>;
let dispose: () => void;
beforeEach(() => {
  mocks.touch = false;
  mocks.platform = 'web';
  vi.clearAllMocks();
  mocks.save.mockResolvedValue({ saved: true });
  mocks.hasIos.mockResolvedValue(true);
  mocks.ios.mockResolvedValue({ canceled: false });
  mocks.android.mockResolvedValue({ canceled: false });
});
afterEach(() => {
  dispose?.();
  vi.unstubAllGlobals();
});

describe('file download lifecycle', () => {
  it('deduplicates preparation and saves the original bytes and filename', async () => {
    const pending = Promise.withResolvers<DownloadResult>();
    const load = vi.fn<DownloadSource['load']>(() => pending.promise);
    const download = createRoot((cleanup) => {
      dispose = cleanup;
      return createFileDownload(() => ({ id: 'video-1', name: 'Video', load }));
    });
    const first = download.start();
    await download.start();
    expect(load).toHaveBeenCalledTimes(1);
    pending.resolve(
      ok({
        blob: new Blob(['original video'], { type: 'video/quicktime' }),
        name: 'Demo.mov',
      })
    );
    await first;
    expect(mocks.save).toHaveBeenCalledTimes(1);
    const saved = mocks.save.mock.calls[0][0];
    expect(saved.name).toBe('Demo.mov');
    expect(saved.type).toBe('video/quicktime');
    expect(saved.size).toBe(14);
    expect(download.busy()).toBe(false);
  });

  it('aborts on cancel and ignores a late result after a retry', async () => {
    const old = Promise.withResolvers<DownloadResult>();
    const next = Promise.withResolvers<DownloadResult>();
    const load = vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(next.promise);
    const download = createRoot((cleanup) => {
      dispose = cleanup;
      return createFileDownload(() => ({
        id: 'video-1',
        name: 'demo.mp4',
        load,
      }));
    });
    const first = download.start();
    const signal = load.mock.calls[0][0].signal;
    download.cancel();
    expect(signal.aborted).toBe(true);
    const retry = download.start();
    old.resolve(ok({ blob: new Blob(['old']) }));
    await first;
    expect(mocks.save).not.toHaveBeenCalled();
    expect(download.phase()).toBe('loading');
    next.resolve(ok({ blob: new Blob(['new']) }));
    await retry;
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });

  it('never downloads stale data after the selected file changes', async () => {
    const pending = Promise.withResolvers<DownloadResult>();
    const [id, setId] = createSignal('first');
    const download = createRoot((cleanup) => {
      dispose = cleanup;
      return createFileDownload(() => ({
        id: id(),
        name: 'demo.mp4',
        load: () => pending.promise,
      }));
    });
    const started = download.start();
    setId('second');
    pending.resolve(ok({ blob: new Blob(['first']) }));
    await started;
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('shares prepared files from a fresh tap when browser activation expired', async () => {
    mocks.touch = true;
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', {
      canShare: () => true,
      share,
      userActivation: { isActive: false },
    });
    const download = createRoot((cleanup) => {
      dispose = cleanup;
      return createFileDownload(() => ({
        id: 'video',
        name: 'demo.mp4',
        load: async () =>
          ok({
            blob: new Blob(['video'], { type: 'video/mp4' }),
          }),
      }));
    });
    await download.start('share');
    expect(download.phase()).toBe('ready');
    expect(share).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    const sharing = download.start('share');
    expect(share).toHaveBeenCalledTimes(1);
    await sharing;
    expect(mocks.success).not.toHaveBeenCalled();
    expect(download.file()).toBeUndefined();
  });

  it('keeps the prepared file after native cancellation without reporting success', async () => {
    mocks.touch = true;
    mocks.platform = 'android';
    mocks.android.mockResolvedValue({ canceled: true });
    const download = createRoot((cleanup) => {
      dispose = cleanup;
      return createFileDownload(() => ({
        id: 'video',
        name: 'demo.mp4',
        load: async () => ok({ blob: new Blob(['video']) }),
      }));
    });
    await download.start();
    expect(download.phase()).toBe('ready');
    expect(download.file()?.name).toBe('demo.mp4');
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.failure).not.toHaveBeenCalled();
  });

  it.each(['web', 'android', 'ios'])(
    'downloads directly on %s without a confirmation step',
    async (platform) => {
      mocks.touch = true;
      mocks.platform = platform;
      const download = createRoot((cleanup) => {
        dispose = cleanup;
        return createFileDownload(() => ({
          id: 'video',
          name: 'demo.mp4',
          load: async () => ok({ blob: new Blob(['video']) }),
        }));
      });
      await download.start();
      expect(
        platform === 'android'
          ? mocks.android
          : platform === 'ios'
            ? mocks.ios
            : mocks.save
      ).toHaveBeenCalledTimes(1);
      expect(download.phase()).toBe('idle');
    }
  );

  it('opens browser sharing directly while the user gesture remains active', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', {
      canShare: () => true,
      share,
      userActivation: { isActive: true },
    });
    const download = createRoot((cleanup) => {
      dispose = cleanup;
      return createFileDownload(() => ({
        id: 'video',
        name: 'demo.mp4',
        load: async () => ok({ blob: new Blob(['video']) }),
      }));
    });
    await download.start('share');
    expect(share).toHaveBeenCalledTimes(1);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('keeps older iOS builds usable through the system share sheet', async () => {
    mocks.platform = 'ios';
    mocks.hasIos.mockResolvedValue(false);
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', {
      canShare: () => true,
      share,
      userActivation: { isActive: false },
    });
    const load = vi.fn(async () => ok({ blob: new Blob(['video']) }));
    const download = createRoot((cleanup) => {
      dispose = cleanup;
      return createFileDownload(() => ({
        id: 'video',
        name: 'demo.mp4',
        load,
      }));
    });
    await download.start();
    expect(download.phase()).toBe('ready');
    const saving = download.start();
    expect(share).toHaveBeenCalledTimes(1);
    await saving;
    expect(load).toHaveBeenCalledTimes(1);
    expect(mocks.ios).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it('allows retry after a network failure', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce(
        err([{ code: 'NETWORK_ERROR', message: 'offline' }])
      )
      .mockResolvedValueOnce(ok({ blob: new Blob(['video']) }));
    const download = createRoot((cleanup) => {
      dispose = cleanup;
      return createFileDownload(() => ({
        id: 'video',
        name: 'demo.mp4',
        load,
      }));
    });
    await download.start();
    expect(download.phase()).toBe('error');
    await download.start();
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });

  it('aborts a pending load on disposal and ignores its late result', async () => {
    const pending = Promise.withResolvers<DownloadResult>();
    const load = vi.fn<DownloadSource['load']>(() => pending.promise);
    const download = createRoot((cleanup) => {
      dispose = cleanup;
      return createFileDownload(() => ({
        id: 'video',
        name: 'demo.mp4',
        load,
      }));
    });
    const started = download.start();
    const signal = load.mock.calls[0][0].signal;
    expect(signal.aborted).toBe(false);
    dispose();
    expect(signal.aborted).toBe(true);
    pending.resolve(ok({ blob: new Blob(['video']) }));
    await started;
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
