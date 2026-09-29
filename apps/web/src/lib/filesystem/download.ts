import { toast } from '@core/component/Toast/Toast';
import { exportAndroidFileWithProgress } from '@core/mobile/exportAndroidFileWithProgress';
import { isPlatform } from '@core/util/platform';

export function downloadFile(blob: Blob, name: string): void {
  if (isPlatform('android')) {
    void saveAndroidFile(blob, name);
    return;
  }
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

async function saveAndroidFile(blob: Blob, name: string) {
  try {
    await exportAndroidFileWithProgress(blob, name);
  } catch (error) {
    console.error('Unable to save file', error);
    toast.failure('Unable to save file');
  }
}
