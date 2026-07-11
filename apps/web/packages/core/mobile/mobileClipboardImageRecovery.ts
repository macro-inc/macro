import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { createSyntheticFileEntry } from '@core/util/dataTransfer';
import { isAndroid, isIOS } from '@solid-primitives/platform';
import { invoke, isTauri } from '@tauri-apps/api/core';
import {
  createNativeStagedUploadFile,
  type NativeStagedUploadData,
} from './nativeStagedUpload';

function isMobilePasteContext(): boolean {
  return isIOS || isAndroid || isNativeMobilePlatform();
}

function hasClipboardText(data: DataTransfer): boolean {
  const types = Array.from(data.types ?? []);
  if (types.includes('text/plain') || types.includes('text/html')) return true;

  return Array.from(data.items ?? []).some((item) => item.kind === 'string');
}

function hasClipboardImageOrFileHint(data: DataTransfer): boolean {
  const types = Array.from(data.types ?? []);
  if (
    types.includes('Files') ||
    types.some((type) => type.startsWith('image/'))
  )
    return true;

  if (
    Array.from(data.items ?? []).some(
      (item) =>
        item.kind === 'file' && (!item.type || item.type.startsWith('image/'))
    )
  ) {
    return true;
  }

  return Array.from(data.files ?? []).some((file) =>
    file.type.startsWith('image/')
  );
}

export function shouldUseMobileClipboardImageRecovery(
  data: DataTransfer
): boolean {
  if (!isMobilePasteContext()) return false;
  if (hasClipboardImageOrFileHint(data)) return true;

  // iOS WKWebView can expose an image paste with an empty ClipboardEvent
  // dataTransfer. Text pastes are still handled by the normal text plugins.
  return !hasClipboardText(data);
}

async function readImageEntryFromNativePasteboard(): Promise<FileSystemFileEntry | null> {
  if (!isTauri()) return null;

  try {
    const image = await invoke<NativeStagedUploadData>(
      'plugin:pasteboard|stage_pasteboard_image'
    );
    const file = createNativeStagedUploadFile('pasteboard', image);
    return file ? createSyntheticFileEntry(file) : null;
  } catch {
    return null;
  }
}

/**
 * Recovers image paste entries through the native pasteboard plugin.
 *
 * Needed on mobile WKWebView where ClipboardEvent.clipboardData can omit image
 * files or expose an empty DataTransfer for image pastes.
 */
export async function recoverMobileClipboardImageEntries(): Promise<
  FileSystemFileEntry[]
> {
  const nativeEntry = await readImageEntryFromNativePasteboard();
  return nativeEntry ? [nativeEntry] : [];
}
