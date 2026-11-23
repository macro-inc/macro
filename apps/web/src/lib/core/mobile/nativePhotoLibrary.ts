import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { isPlatform } from '@core/util/platform';
import { Telemetry } from '@macro-inc/observability';
import { invoke, isTauri } from '@tauri-apps/api/core';
import {
  createNativeStagedUploadFile,
  type NativeStagedUploadData,
} from './nativeStagedUpload';

/**
 * Opens the native iOS photo library picker.
 *
 * Returns the picked files (empty when the user cancels), or `null` when the
 * native picker is unavailable so callers can fall back to a file input.
 */
async function pickNativePhotoLibraryMedia(): Promise<File[] | null> {
  if (!isTauri() || !isPlatform('ios')) return null;

  let media: NativeStagedUploadData[];
  try {
    media = await invoke<NativeStagedUploadData[]>(
      'plugin:photo-library|pick_photo_library_images'
    );
  } catch (error) {
    Telemetry.error(error, { surface: 'photo-library-picker' });
    return null;
  }

  return media
    .map((item) => createNativeStagedUploadFile('photo-library', item))
    .filter((file): file is File => file !== null);
}

/**
 * Opens the native photo library, or the file input when it is unavailable.
 *
 * Off iOS the file input opens at once, inside the tap. On iOS the native
 * picker answers over IPC, after the tap's user activation has ended, and
 * WKWebView silently ignores a file input click without one. So when the
 * native picker fails, a toast offers the file input behind a fresh tap.
 */
export async function pickPhotoLibraryMediaOrFiles(
  openFileInput: () => void
): Promise<File[]> {
  if (!isTauri() || !isPlatform('ios')) {
    openFileInput();
    return [];
  }
  const files = await pickNativePhotoLibraryMedia();
  if (files !== null) return files;
  const toastId = toast.failure(t('common.photoLibraryUnavailable'), {
    actions: [
      {
        label: t('common.chooseFiles'),
        onClick: () => {
          if (toastId !== undefined) toast.dismiss(toastId);
          openFileInput();
        },
      },
    ],
  });
  return [];
}
