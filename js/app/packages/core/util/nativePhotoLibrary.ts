import { invoke, isTauri } from '@tauri-apps/api/core';
import {
  createNativeStagedUploadFile,
  type NativeStagedUploadData,
} from './nativeStagedUpload';

export async function pickNativePhotoLibraryImages(): Promise<File[]> {
  if (!isTauri()) return [];

  const images = await invoke<NativeStagedUploadData[]>(
    'plugin:photo-library|pick_photo_library_images'
  );

  return images
    .map((image) => createNativeStagedUploadFile('photo-library', image))
    .filter((file): file is File => file !== null);
}
