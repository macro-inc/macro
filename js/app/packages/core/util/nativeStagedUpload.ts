import { convertFileSrc, invoke } from '@tauri-apps/api/core';

/**
 * Native pasteboard staging bridge.
 *
 * iOS pasteboard images are staged on disk and represented briefly as
 * placeholder `File`s so they can cross existing browser paste boundaries.
 * Staging does not start a network upload; the Rust upload starts later, after
 * JS obtains a presigned URL.
 */

export type NativeStagedUploadData = {
  token: string | null;
  name: string | null;
  mimeType: string | null;
  size: number | null;
  previewPath: string | null;
};

export type NativeStagedUpload = {
  source: 'pasteboard';
  token: string;
  name: string;
  mimeType: string;
  size: number;
  previewSrc?: string;
};

const nativeStagedUploads = new WeakMap<File, NativeStagedUpload>();

export function createNativeStagedUploadFile(
  image: NativeStagedUploadData
): File | null {
  if (!image.token || !image.name || !image.mimeType || image.size == null) {
    return null;
  }

  const file = new File([], image.name, { type: image.mimeType });
  nativeStagedUploads.set(file, {
    source: 'pasteboard',
    token: image.token,
    name: image.name,
    mimeType: image.mimeType,
    size: image.size,
    previewSrc: image.previewPath
      ? convertFileSrc(image.previewPath)
      : undefined,
  });
  return file;
}

export function getNativeStagedUpload(
  file: File
): NativeStagedUpload | undefined {
  return nativeStagedUploads.get(file);
}

/**
 * Starts and awaits the Rust-side upload of a staged native file without
 * pulling the bytes through JS.
 */
export async function uploadNativeStagedFileToPresignedUrl(
  file: NativeStagedUpload,
  uploadUrl: string
): Promise<void> {
  await invoke('upload_staged_file_to_presigned_url', {
    source: file.source,
    token: file.token,
    uploadUrl,
    mimeType: file.mimeType,
  });
}
