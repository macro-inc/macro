import {
  getNativeStagedUpload,
  type NativeStagedUploadSource,
  uploadNativeStagedFileToPresignedUrl,
} from '@core/mobile/nativeStagedUpload';
import { invalidateUserQuota } from '@queries/auth';
import { staticFileClient } from '@service-static-files/client';
import { contentHash } from './hash';
import { resolveUploadContentType } from './uploadContentType';

/**
 * App-level upload file model.
 *
 * In Tauri app file uploads are handled on the Rust-side. Paste/drop boundaries thus need to briefly carry native staged uploads as placeholder `Files`s.
 *
 * Immediately normalize those placeholders with `createUploadFile`.
 */

export type BrowserUploadFile = {
  kind: 'browser';
  file: File;
  name: string;
  mimeType: string;
  size: number;
};

export type NativeStagedUploadFile = {
  kind: 'native-staged';
  file: File;
  source: NativeStagedUploadSource;
  token: string;
  name: string;
  mimeType: string;
  size: number;
  previewSrc?: string;
};

export type UploadFile = BrowserUploadFile | NativeStagedUploadFile;

export function createUploadFile(file: File): UploadFile {
  const staged = getNativeStagedUpload(file);
  if (staged) {
    return {
      kind: 'native-staged',
      file,
      ...staged,
    };
  }

  return {
    kind: 'browser',
    file,
    name: file.name,
    mimeType: file.type,
    size: file.size,
  };
}

export function isNativeStagedUpload(
  file: UploadFile
): file is NativeStagedUploadFile {
  return file.kind === 'native-staged';
}

export async function createStaticUploadFile(
  file: UploadFile
): Promise<string> {
  const contentType = resolveUploadContentType(file);
  const result = await staticFileClient.makePresignedUrl({
    file_name: file.name,
    content_type: contentType,
  });
  invalidateUserQuota();
  if (result.isErr()) throw new Error('Failed to upload file');

  const { upload_url, id } = result.value;
  if (isNativeStagedUpload(file)) {
    await uploadNativeStagedFileToPresignedUrl(file, upload_url);
    return id;
  }

  const uploadResult = await staticFileClient.uploadToPresignedUrl({
    url: upload_url,
    blob: file.file,
    contentType,
  });
  if (!uploadResult.success) {
    throw new Error('Failed to upload file');
  }
  return id;
}

/**
 * Returns a browser-readable source for metadata extraction. For native staged
 * files this is the Tauri asset URL for the staged file; for regular files it
 * returns the File itself.
 */
export function getUploadFilePreviewSource(file: UploadFile): File | string {
  return isNativeStagedUpload(file)
    ? (file.previewSrc ?? file.file)
    : file.file;
}

/**
 * Creates the URL used for local media nodes. Native staged files already have
 * a Tauri asset URL, while regular files need an object URL.
 */
export function createUploadFilePreviewUrl(file: UploadFile): string {
  return isNativeStagedUpload(file) && file.previewSrc
    ? file.previewSrc
    : URL.createObjectURL(file.file);
}

/**
 * Builds a stable upload key without reading bytes from native staged files.
 * Their JS `File` is empty, so hashing `file.slice()` would hash the wrong data.
 */
export async function getUploadFileCacheKey(
  file: UploadFile,
  chunks = 8
): Promise<string> {
  if (isNativeStagedUpload(file)) {
    return `${file.name}_${file.size}_${file.token}`;
  }

  const hash = await contentHash(
    await file.file.slice(0, chunks * 1024).arrayBuffer()
  );
  return `${file.name}_${file.size}_${hash}`;
}
