import { convertFileSrc, invoke } from '@tauri-apps/api/core';

/**
 * Native staged upload bridge.
 *
 * Some iOS sources, like pasteboard images and photo-library media, stage
 * bytes on disk and hand JS a placeholder `File`. Staging does not start a
 * network upload; the Rust upload starts later, after JS obtains a presigned
 * URL.
 */

export type NativeStagedUploadSource = 'pasteboard' | 'photo-library';

export type NativeStagedUploadData = {
  token: string | null;
  name: string | null;
  mimeType: string | null;
  size: number | null;
  previewPath: string | null;
};

export type NativeStagedUpload = {
  source: NativeStagedUploadSource;
  token: string;
  name: string;
  mimeType: string;
  size: number;
  previewSrc?: string;
};

const nativeStagedUploads = new WeakMap<File, NativeStagedUpload>();

export function createNativeStagedUploadFile(
  source: NativeStagedUploadSource,
  media: NativeStagedUploadData
): File | null {
  if (!media.token || !media.name || !media.mimeType || media.size == null) {
    return null;
  }

  const file = new File([], media.name, { type: media.mimeType });
  nativeStagedUploads.set(file, {
    source,
    token: media.token,
    name: media.name,
    mimeType: media.mimeType,
    size: media.size,
    previewSrc: media.previewPath
      ? convertFileSrc(media.previewPath)
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
