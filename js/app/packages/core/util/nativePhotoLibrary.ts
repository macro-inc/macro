import { invoke, isTauri } from '@tauri-apps/api/core';
import {
  createNativeStagedUploadFile,
  type NativeStagedUploadData,
} from './nativeStagedUpload';

export async function pickNativePhotoLibraryMedia(): Promise<File[]> {
  if (!isTauri()) return [];

  const media = await invoke<NativeStagedUploadData[]>(
    'plugin:photo-library|pick_photo_library_images'
  );

  return media
    .map((item) => createNativeStagedUploadFile('photo-library', item))
    .filter((file): file is File => file !== null);
}
