import { contentHash } from '@core/util/hash';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';

/**
 * Native staged upload bridge.
 *
 * Some iOS sources, like pasteboard images and photo-library media, stage
 * bytes on disk and hand JS a placeholder `File`. Staging does not start a
 * network upload; the Rust upload starts later, after JS obtains a presigned
 * URL.
 */

export type NativeStagedUploadSource = 'pasteboard' | 'photo-library' | 'share';

export type NativeStagedUploadData = {
  token: string | null;
  name: string | null;
  mimeType: string | null;
  size: number | null;
  previewPath: string | null;
  sha256?: string;
};

export type NativeStagedUpload = {
  source: NativeStagedUploadSource;
  token: string;
  name: string;
  mimeType: string;
  size: number;
  previewSrc?: string;
  sha256?: string;
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
    sha256: media.sha256,
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
  uploadUrl: string,
  checksumSha256?: string
): Promise<void> {
  await invoke('upload_staged_file_to_presigned_url', {
    source: file.source,
    token: file.token,
    uploadUrl,
    mimeType: file.mimeType,
    checksumSha256,
  });
}

/** Native placeholders have no JS bytes; use their staged byte count for limits. */
export function getUploadFileSize(file: File): number {
  return getNativeStagedUpload(file)?.size ?? file.size;
}

/**
 * Android staging supplies a digest. The iOS plugins stage the original bytes
 * but no digest, so hash them through the asset protocol; this pulls the file
 * into JS memory once and caches the result for retries.
 */
export async function getNativeStagedUploadChecksum(
  file: NativeStagedUpload
): Promise<string> {
  if (file.sha256) return file.sha256;
  if (!file.previewSrc) throw new Error('Native attachment bytes unavailable');
  // Use the WebView's asset protocol, not the native HTTP client, for local files.
  const response = await fetch(file.previewSrc);
  if (!response.ok) throw new Error('Unable to read native attachment');
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== file.size)
    throw new Error('Native attachment size mismatch');
  file.sha256 = await contentHash(bytes);
  return file.sha256;
}

/** Either JS bytes or a native staged file, with the fields uploads need. */
export type UploadSource =
  | { kind: 'bytes'; buffer: ArrayBuffer; sha: string; size: number }
  | { kind: 'staged'; staged: NativeStagedUpload; sha: string; size: number };

export async function resolveUploadSource(file: File): Promise<UploadSource> {
  const staged = getNativeStagedUpload(file);
  if (staged) {
    const sha = await getNativeStagedUploadChecksum(staged);
    return { kind: 'staged', staged, sha, size: staged.size };
  }
  const buffer = await file.arrayBuffer();
  return {
    kind: 'bytes',
    buffer,
    sha: await contentHash(buffer),
    size: file.size,
  };
}

/** S3 expects the native SHA-256 digest as base64 rather than hexadecimal. */
export function nativeUploadChecksum(sha256: string): string {
  if (!/^[a-f0-9]{64}$/i.test(sha256))
    throw new Error('Invalid staged file checksum');
  let binary = '';
  for (let index = 0; index < sha256.length; index += 2) {
    binary += String.fromCharCode(
      Number.parseInt(sha256.slice(index, index + 2), 16)
    );
  }
  return btoa(binary);
}
