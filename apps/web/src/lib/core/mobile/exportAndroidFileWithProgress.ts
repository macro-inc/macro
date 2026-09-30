import { toast } from '@core/component/Toast/Toast';
import { createSignal } from 'solid-js';
import { type AndroidFileAction, exportAndroidFile } from './androidFiles';

/** Keep long Blob transfers visible and cancelable before launching a file action. */
export async function exportAndroidFileWithProgress(
  blob: Blob,
  name: string,
  action: AndroidFileAction = 'save'
): Promise<{ canceled: boolean }> {
  if (blob.size < 1024 * 1024) return exportAndroidFile(blob, name, action);
  const controller = new AbortController();
  const [progress, setProgress] = createSignal(0);
  const id = toast.custom(
    {
      get title() {
        return `Preparing file… ${Math.round(progress() * 100)}%`;
      },
      actions: [{ label: 'Cancel', onClick: () => controller.abort() }],
    },
    { persistent: true }
  );
  try {
    return await exportAndroidFile(blob, name, action, {
      signal: controller.signal,
      onProgress: (fraction) => {
        setProgress(fraction);
        if (fraction === 1) toast.dismiss(id);
      },
    });
  } catch (error) {
    if (controller.signal.aborted) return { canceled: true };
    throw error;
  } finally {
    toast.dismiss(id);
  }
}
