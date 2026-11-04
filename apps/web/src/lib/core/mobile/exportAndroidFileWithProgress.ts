import { toast } from '@core/component/Toast/Toast';
import { createSignal } from 'solid-js';
import { type AndroidFileAction, exportAndroidFile } from './androidFiles';

/** Keep long Blob transfers visible and cancelable before launching a file action. */
export async function exportAndroidFileWithProgress(
  blob: Blob,
  name: string,
  action: AndroidFileAction = 'save',
  signal?: AbortSignal
): Promise<{ canceled: boolean }> {
  if (signal?.aborted) return { canceled: true };
  if (blob.size < 1024 * 1024) {
    try {
      return await exportAndroidFile(blob, name, action, { signal });
    } catch (error) {
      if (signal?.aborted) return { canceled: true };
      throw error;
    }
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
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
        // The transfer is done before the native chooser opens over the app.
        if (fraction === 1) toast.dismiss(id);
      },
    });
  } catch (error) {
    if (controller.signal.aborted) return { canceled: true };
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
    toast.dismiss(id);
  }
}
