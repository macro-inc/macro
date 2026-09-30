import { toast } from '@core/component/Toast/Toast';
import { exportAndroidFileWithProgress } from '@core/mobile/exportAndroidFileWithProgress';
import { isPlatform } from '@core/util/platform';

/**
 * Hands a Blob to the platform's save flow. Browsers download immediately;
 * Android opens a save dialog. `saved` is false when the user cancels or the
 * save fails; failures are already reported with a toast, so callers only
 * need the outcome to decide what happens next.
 */
export async function downloadFile(
  blob: Blob,
  name: string
): Promise<{ saved: boolean }> {
  try {
    if (isPlatform('android')) {
      const { canceled } = await exportAndroidFileWithProgress(blob, name);
      return { saved: !canceled };
    }
    downloadWithAnchor(blob, name);
    return { saved: true };
  } catch (error) {
    console.error('Unable to save file', error);
    toast.failure('Unable to save file');
    return { saved: false };
  }
}

function downloadWithAnchor(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  let anchor: HTMLAnchorElement | null = null;
  try {
    anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.ariaLabel = 'hidden-download-link';
    anchor.style.display = 'none';

    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    // Clean up even if an error occurs
    if (anchor != null) {
      document.body.removeChild(anchor);
    }
    URL.revokeObjectURL(url);
  }
}
