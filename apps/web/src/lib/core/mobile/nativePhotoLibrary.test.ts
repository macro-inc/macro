import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pickPhotoLibraryMediaOrFiles } from './nativePhotoLibrary';

const native = vi.hoisted(() => ({
  tauri: true,
  ios: true,
  invoke: vi.fn<(command: string) => Promise<unknown>>(),
}));
const failure = vi.hoisted(() => vi.fn((..._args: unknown[]) => 7));
const dismiss = vi.hoisted(() => vi.fn());
const telemetryError = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: native.invoke,
  isTauri: () => native.tauri,
  convertFileSrc: (path: string) => `asset://${path}`,
}));
vi.mock('@core/util/platform', () => ({
  isPlatform: (platform: string) => platform === 'ios' && native.ios,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure, dismiss },
}));
vi.mock('@macro-inc/observability', () => ({
  Telemetry: { error: telemetryError },
}));
vi.mock('@app/lib/i18n', () => ({ t: (key: string) => key }));

type ToastOptions = { actions: { label: string; onClick: () => void }[] };

beforeEach(() => {
  native.tauri = true;
  native.ios = true;
  native.invoke.mockReset();
  failure.mockClear();
  dismiss.mockClear();
  telemetryError.mockClear();
});

describe('pickPhotoLibraryMediaOrFiles', () => {
  it.each([
    ['the web', false, false],
    ['Android', true, false],
  ])('opens the file input within the tap on %s', async (_, tauri, ios) => {
    native.tauri = tauri;
    native.ios = ios;
    const openFileInput = vi.fn();

    const picking = pickPhotoLibraryMediaOrFiles(openFileInput);

    expect(openFileInput).toHaveBeenCalledOnce();
    await expect(picking).resolves.toEqual([]);
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it('returns native photo library picks without the file input', async () => {
    native.invoke.mockResolvedValue([
      {
        token: 'photo-token',
        name: 'IMG_0001.jpg',
        mimeType: 'image/jpeg',
        size: 1234,
        previewPath: '/staged/IMG_0001.jpg',
      },
    ]);
    const openFileInput = vi.fn();

    const files = await pickPhotoLibraryMediaOrFiles(openFileInput);

    expect(native.invoke).toHaveBeenCalledExactlyOnceWith(
      'plugin:photo-library|pick_photo_library_images'
    );
    expect(files.map((file) => file.name)).toEqual(['IMG_0001.jpg']);
    expect(openFileInput).not.toHaveBeenCalled();
    expect(failure).not.toHaveBeenCalled();
  });

  it('attaches nothing and opens nothing when the native picker is cancelled', async () => {
    native.invoke.mockResolvedValue([]);
    const openFileInput = vi.fn();

    await expect(pickPhotoLibraryMediaOrFiles(openFileInput)).resolves.toEqual(
      []
    );
    expect(openFileInput).not.toHaveBeenCalled();
    expect(failure).not.toHaveBeenCalled();
  });

  it('offers the file input behind a fresh tap when the native picker fails', async () => {
    const error = new Error(
      'Photo library picker cannot be presented right now'
    );
    native.invoke.mockRejectedValue(error);
    const openFileInput = vi.fn();

    await expect(pickPhotoLibraryMediaOrFiles(openFileInput)).resolves.toEqual(
      []
    );

    // A click this late would be ignored by WKWebView; the toast's button
    // carries its own user activation.
    expect(openFileInput).not.toHaveBeenCalled();
    expect(telemetryError).toHaveBeenCalledExactlyOnceWith(error, {
      surface: 'photo-library-picker',
    });
    expect(failure).toHaveBeenCalledOnce();
    const [message, options] = failure.mock.calls[0] as [string, ToastOptions];
    expect(message).toBe('common.photoLibraryUnavailable');
    const [action] = options.actions;
    expect(action.label).toBe('common.chooseFiles');

    action.onClick();

    expect(openFileInput).toHaveBeenCalledOnce();
    expect(dismiss).toHaveBeenCalledExactlyOnceWith(7);
  });
});
