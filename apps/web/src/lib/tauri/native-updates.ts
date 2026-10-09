import { toast } from '@core/component/Toast/Toast';
import { isPlatform } from '@core/util/platform';
import { hasAutomaticReloadHolds } from '@core/util/reloadForNewerBuild';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { createSignal, onCleanup, onMount } from 'solid-js';
import { match } from 'ts-pattern';
import { createNativeUpdatePreparation } from './native-update-preparation';

export type NativeUpdateStatus =
  | { status: 'Disabled' | 'Idle' | 'Checking' | 'Installing' }
  | { status: 'Downloading' | 'Ready'; data: { version: string } }
  | { status: 'Error'; data: { message: string } };

export function nativeUpdateDescription(status: NativeUpdateStatus): string {
  return match(status)
    .with(
      { status: 'Disabled' },
      () => 'Download the latest Macro app to update.'
    )
    .with(
      { status: 'Idle' },
      () => 'Macro checks for app updates automatically.'
    )
    .with({ status: 'Checking' }, () => 'Checking for an app update…')
    .with({ status: 'Downloading' }, () => 'Downloading an app update…')
    .with(
      { status: 'Ready' },
      () => 'An app update is ready. It will install when you quit Macro.'
    )
    .with({ status: 'Installing' }, () => 'Installing the app update…')
    .with({ status: 'Error' }, (value) => value.data.message)
    .exhaustive();
}

/** Desktop lifecycle integration, scoped to the Tauri provider. */
export function createNativeUpdates(flush: () => Promise<void>) {
  const preparation = createNativeUpdatePreparation({
    isBlocked: hasAutomaticReloadHolds,
    flush,
  });
  const [preparing, setPreparing] = createSignal(false);
  const [status, setStatus] = createSignal<NativeUpdateStatus>({
    status: 'Disabled',
  });
  let disposed = false;
  let unsubscribe = () => {};

  async function restart() {
    if (status().status !== 'Ready' || preparing()) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      setPreparing(true);
      await Promise.race([
        preparation.prepare(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                new Error(
                  'Saving is taking longer than expected. Try restarting again after your changes finish saving.'
                )
              ),
            15_000
          );
        }),
      ]);
      await invoke('restart_native_update');
    } catch (error) {
      setPreparing(false);
      toast.failure(
        error instanceof Error
          ? error.message
          : 'Could not restart Macro. Try again after your changes finish saving.'
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  function receive(next: NativeUpdateStatus) {
    if (disposed) return;
    setStatus(next);
  }

  async function initialize() {
    let receivedEvent = false;
    try {
      const stop = await listen<NativeUpdateStatus>(
        'native-update-status',
        (event) => {
          receivedEvent = true;
          receive(event.payload);
        }
      );
      if (disposed) {
        stop();
        return;
      }
      unsubscribe = stop;
      const current = await invoke<NativeUpdateStatus>(
        'get_native_update_status'
      );
      if (!receivedEvent) receive(current);
    } catch {
      // Older binaries can load this OTA bundle but do not have the command.
      // They retain the existing manual native-upgrade flow.
    }
  }

  onMount(() => {
    if (isPlatform('desktop')) void initialize();
  });
  onCleanup(() => {
    disposed = true;
    unsubscribe();
  });
  return {
    status,
    restart,
    preparing,
    registerPreparation: preparation.register,
  };
}
