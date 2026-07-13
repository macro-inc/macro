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
export async function pickNativePhotoLibraryMedia(): Promise<File[] | null> {
  if (!isTauri()) return null;

  let media: NativeStagedUploadData[];
  try {
    media = await invoke<NativeStagedUploadData[]>(
      'plugin:photo-library|pick_photo_library_images'
    );
  } catch (error) {
    console.warn('Photo library picker failed', error);
    return null;
  }

  return media
    .map((item) => createNativeStagedUploadFile('photo-library', item))
    .filter((file): file is File => file !== null);
}
