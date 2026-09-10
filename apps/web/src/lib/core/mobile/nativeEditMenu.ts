import { isPlatform } from '@core/util/platform';
import { invoke } from '@tauri-apps/api/core';

/**
 * Whether the native iOS edit-menu integration applies: suppression of the
 * system text-selection menu and pasteboard reads for the in-app Paste.
 */
export function hasNativeEditMenu(): boolean {
  return isPlatform('ios');
}

/**
 * Toggles suppression of the native iOS text-selection menu so it doesn't
 * stack on top of the in-app selection popup. No-op outside the iOS app.
 */
export function setNativeEditMenuSuppressed(suppressed: boolean): void {
  if (!hasNativeEditMenu()) return;
  void invoke('plugin:edit-menu|set_native_menu_suppressed', {
    suppressed,
  }).catch((error) => {
    console.error('failed to toggle native edit menu suppression', error);
  });
}

/**
 * Reads plain text from the system pasteboard. Returns null when unavailable
 * (not the iOS app, or no text on the pasteboard).
 */
export async function readNativePasteboardText(): Promise<string | null> {
  if (!hasNativeEditMenu()) return null;
  try {
    const result = await invoke<{ text: string | null }>(
      'plugin:pasteboard|read_pasteboard_text'
    );
    return result.text;
  } catch (error) {
    console.error('failed to read pasteboard text', error);
    return null;
  }
}
