import {
  type NativeStagedUploadData,
  tagNativeStagedUpload,
} from '@core/mobile/nativeStagedUpload';
import { createSyntheticFileEntry } from '@core/util/dataTransfer';
import { isDesktopPlatform } from '@core/util/platform';
import { invoke } from '@tauri-apps/api/core';
import { ResultAsync } from 'neverthrow';

/**
 * Pasted files at least this large upload from Rust. Below it the Tauri HTTP
 * plugin's in-memory copy of the body is harmless.
 */
const NATIVE_PASTE_MIN_BYTES = 16 * 1024 * 1024;

/**
 * Whether a desktop paste should stage its files natively. The Tauri HTTP
 * plugin copies an upload body into the renderer, so a large pasted video
 * crashes the desktop app unless Rust uploads it from disk.
 */
export function shouldStageDesktopPasteFiles(files: File[]): boolean {
  return (
    isDesktopPlatform() &&
    files.some((file) => file.size >= NATIVE_PASTE_MIN_BYTES)
  );
}

/**
 * Stages the pasteboard's files in Rust and tags each matching pasted `File`,
 * so uploads stream the staged copy instead of reading it into JS. Files Rust
 * can't match (an image copied as data, other platforms) stay browser files.
 */
export async function stageDesktopPasteFiles(
  files: File[]
): Promise<FileSystemFileEntry[]> {
  const staged = await ResultAsync.fromPromise(
    invoke<NativeStagedUploadData[]>('stage_desktop_pasteboard_files'),
    (error) => error
  );
  if (staged.isErr()) {
    console.error('Failed to stage pasted files', staged.error);
    return files.map(createSyntheticFileEntry);
  }

  const unclaimed = [...staged.value];
  for (const file of files) {
    const index = unclaimed.findIndex(
      (media) => media.name === file.name && media.size === file.size
    );
    if (index === -1) continue;
    const [media] = unclaimed.splice(index, 1);
    // Previews keep using the real File; only the upload goes through Rust.
    tagNativeStagedUpload(file, 'pasteboard', {
      ...media,
      mimeType: file.type || media.mimeType,
      previewPath: null,
    });
  }

  return files.map(createSyntheticFileEntry);
}
