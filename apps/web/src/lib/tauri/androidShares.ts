import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  addPluginListener,
  convertFileSrc,
  invoke,
} from '@tauri-apps/api/core';
import { onCleanup, onMount } from 'solid-js';
import type { PendingShareFile } from './ShareTargetProvider';

type AndroidSharedFile = Omit<PendingShareFile, 'previewSrc'> & {
  previewPath?: string;
};

/** The native queue is acknowledged only after cancel/send, including across login. */
export function useAndroidShares(
  setFiles: (files: PendingShareFile[]) => void
) {
  onMount(() => {
    let disposed = false;
    let loading = false;
    let reload = false;
    let remove: (() => Promise<void>) | undefined;
    const refresh = async () => {
      reload = true;
      if (loading) return;
      loading = true;
      try {
        while (reload && !disposed) {
          reload = false;
          const { files, error } = await invoke<{
            files: AndroidSharedFile[];
            error?: string;
          }>('plugin:android-mobile|getPendingShares');
          if (!disposed && error) toast.failure(error);
          if (!disposed)
            setFiles(
              files.map(({ previewPath, ...file }) => ({
                ...file,
                previewSrc: previewPath
                  ? convertFileSrc(previewPath)
                  : undefined,
              }))
            );
        }
      } catch (error) {
        console.error('Unable to load Android shares', error);
        toast.failure('Unable to load shared attachments');
      } finally {
        loading = false;
      }
    };
    const initialize = async () => {
      try {
        const listener = await addPluginListener<{ error?: string }>(
          'android-mobile',
          'shares',
          ({ error }) => {
            if (error) toast.failure(error);
            fireAndForget(refresh(), 'android-shares');
          }
        );
        if (disposed) {
          await listener.unregister();
          return;
        }
        remove = () => listener.unregister();
        await refresh();
      } catch (error) {
        console.error('Unable to listen for Android shares', error);
      }
    };
    fireAndForget(initialize(), 'android-shares');
    onCleanup(() => {
      disposed = true;
      if (remove) fireAndForget(remove(), 'android-shares');
    });
  });
}
