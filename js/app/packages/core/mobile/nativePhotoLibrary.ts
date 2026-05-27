import { invoke, isTauri } from '@tauri-apps/api/core';
import {
  createNativeStagedUploadFile,
  type NativeStagedUploadData,
} from './nativeStagedUpload';

export async function pickNativePhotoLibraryMedia(): Promise<File[]> {
  if (!isTauri()) return [];

  let media: NativeStagedUploadData[];
  try {
    media = await invoke<NativeStagedUploadData[]>(
      'plugin:photo-library|pick_photo_library_images'
    );
  } catch (error) {
    console.warn('Photo library picker failed', error);
    return [];
  }

  return media
    .map((item) => createNativeStagedUploadFile('photo-library', item))
    .filter((file): file is File => file !== null);
}
