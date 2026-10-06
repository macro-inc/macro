import { NativeCallProvider } from '@channel/Call/native-call-state';
import { useCallKitSetup } from '@channel/Call/use-callkit';
import { useAndroidBack } from '@core/mobile/androidBack';
import { useAndroidWindowInsets } from '@core/mobile/androidWindowInsets';
import { NativeAppUpdateRequiredDialog } from '@core/mobile/NativeAppUpdateRequiredDialog';
import { isPlatform, isTauri } from '@core/util/platform';
import { PlatformNotificationProvider } from '@notifications';
import { queryPersistence } from '@queries/client';
import type { RouteSectionProps } from '@solidjs/router';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { type OsType, type as osType } from '@tauri-apps/plugin-os';
import { Dialog, Surface } from '@ui';
import {
  type Accessor,
  createContext,
  createEffect,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  useContext,
} from 'solid-js';
import {
  createNativeUpdates,
  type NativeUpdateStatus,
  nativeUpdateDescription,
} from './native-updates';
import { useTauriNavigationEffect } from './navigation';
import { MaybePushNotificationRegistration } from './PushNotification';
import { ShareTargetProvider } from './ShareTargetProvider';

export type BundleUpdateStatus =
  | { status: 'Idle' }
  | { status: 'CheckingForUpdate' }
  | { status: 'UpdateFound'; data: { version: string; notes: string | null } }
  | { status: 'NoUpdateNeeded' }
  | { status: 'WaitingForWifi' }
  | { status: 'Downloading'; data: { progress: number } }
  | { status: 'Unzipping'; data: { progress: number } }
  | { status: 'ClearRequired'; data: { reason: string } }
  | {
      status: 'NativeUpdateRequired';
      data: { bundleBuild: number; minNativeBuild: number };
    }
  | { status: 'Completed' }
  | { status: 'Error'; data: { message: string } };

interface TauriContextValue {
  os: OsType;
  bundleUpdateStatus: Accessor<BundleUpdateStatus>;
  nativeUpdateStatus: Accessor<NativeUpdateStatus>;
  restartNativeUpdate: () => Promise<void>;
  registerNativeUpdatePreparation: (save: () => Promise<void>) => () => void;
}

const TauriContext = createContext<TauriContextValue | undefined>(undefined);

const LOADED_BUNDLE_BUILD = (() => {
  if (typeof document === 'undefined') return undefined;
  const value = document
    .querySelector<HTMLMetaElement>('meta[name="macro-bundle-build"]')
    ?.getAttribute('content');
  if (value === undefined || value === null || !/^\d+$/.test(value)) {
    return undefined;
  }
  const bundleBuild = Number(value);
  return Number.isSafeInteger(bundleBuild) ? bundleBuild : undefined;
})();

function shouldShowNativeAppUpdateRequiredDialog(status: BundleUpdateStatus) {
  return (
    status.status === 'ClearRequired' ||
    status.status === 'NativeUpdateRequired'
  );
}

function TauriProvider(props: { children: JSX.Element }) {
  const nativeUpdates = createNativeUpdates(queryPersistence.flush);
  useAndroidWindowInsets();
  useAndroidBack();
  const [bundleUpdateStatus, setBundleUpdateStatus] =
    createSignal<BundleUpdateStatus>({ status: 'Idle' });
  const [
    nativeAppUpdateRequiredDialogOpen,
    setNativeAppUpdateRequiredDialogOpen,
  ] = createSignal(false);
  let hasShownNativeAppUpdateRequiredDialog = false;

  function performBundleUpdate() {
    invoke<boolean>('perform_update').catch((e) =>
      console.error('[bundle-update] perform_update failed', e)
    );
  }

  createEffect(() => {
    if (
      hasShownNativeAppUpdateRequiredDialog ||
      !shouldShowNativeAppUpdateRequiredDialog(bundleUpdateStatus())
    ) {
      return;
    }

    hasShownNativeAppUpdateRequiredDialog = true;
    setNativeAppUpdateRequiredDialogOpen(true);
  });

  if (isTauri() && isPlatform('ios')) useCallKitSetup();

  const value: TauriContextValue = {
    os: osType(),
    bundleUpdateStatus,
    nativeUpdateStatus: nativeUpdates.status,
    restartNativeUpdate: nativeUpdates.restart,
    registerNativeUpdatePreparation: nativeUpdates.registerPreparation,
  };

  onMount(() => {
    const unlistenPromise = listen<BundleUpdateStatus>(
      'bundle-update-status',
      (ev) => {
        setBundleUpdateStatus(ev.payload);
      }
    );
    if (LOADED_BUNDLE_BUILD !== undefined) {
      invoke<boolean>('ack_bundle_update_reload', {
        loadedBundleBuild: LOADED_BUNDLE_BUILD,
      }).catch((e) =>
        console.error('[bundle-update] ack_bundle_update_reload failed', e)
      );
    }
    // Fetch current status since events emitted before the listener registered are missed
    invoke<BundleUpdateStatus>('get_bundle_update_status').then((status) => {
      setBundleUpdateStatus(status);
    });
    onCleanup(() => {
      unlistenPromise.then((unlisten) => unlisten());
    });

    document.body.classList.add('tauri');
    document.body.classList.add(`tauri-${value.os}`);

    const onBundleUpdateVisibilityChange = () => {
      // iOS gives us a short JS execution window after the app is backgrounded.
      // Use it to ask Rust to apply a completed bundle before suspension;
      // native Ready/Resumed handlers cover cases where this window is missed.
      if (document.hidden) {
        performBundleUpdate();
      }
    };
    document.addEventListener(
      'visibilitychange',
      onBundleUpdateVisibilityChange
    );
    onCleanup(() => {
      document.removeEventListener(
        'visibilitychange',
        onBundleUpdateVisibilityChange
      );
    });
  });

  return (
    <TauriContext.Provider value={value}>
      <ShareTargetProvider os={value.os}>{props.children}</ShareTargetProvider>
      <Dialog
        open={nativeUpdates.preparing()}
        onOpenChange={() => {}}
        class="w-[90%] max-w-120"
        position="center"
      >
        <Surface depth={2}>
          <div class="flex flex-col gap-2 px-4 py-5">
            <Dialog.Title class="text-lg font-semibold text-ink">
              Restarting Macro
            </Dialog.Title>
            <Dialog.Description class="text-sm text-ink-extra-muted">
              Saving your changes before installing the app update…
            </Dialog.Description>
          </div>
        </Surface>
      </Dialog>
      <NativeAppUpdateRequiredDialog
        open={nativeAppUpdateRequiredDialogOpen()}
        onClose={() => setNativeAppUpdateRequiredDialogOpen(false)}
        description={
          isPlatform('desktop') && nativeUpdates.status().status !== 'Disabled'
            ? nativeUpdateDescription(nativeUpdates.status())
            : undefined
        }
        onRestart={
          nativeUpdates.status().status === 'Ready'
            ? () => void nativeUpdates.restart()
            : undefined
        }
      />
    </TauriContext.Provider>
  );
}

export function MaybeTauriProvider(props: { children: JSX.Element }) {
  if (isTauri()) {
    return (
      <NativeCallProvider>
        <TauriProvider>
          <MaybePushNotificationRegistration>
            {props.children}
          </MaybePushNotificationRegistration>
        </TauriProvider>
      </NativeCallProvider>
    );
  }

  return (
    <PlatformNotificationProvider>
      {props.children}
    </PlatformNotificationProvider>
  );
}

/// return the value of the tauri context
export function useTauri() {
  return useContext(TauriContext);
}

/// same as useTauri but throws if the structure of the component tree is invalid
export function useExpectTauri() {
  const res = useTauri();
  if (res === undefined) {
    throw new Error(
      'Tauri Context was not found, did you mean to call useTauri instead?'
    );
  }

  return res;
}

/// we need this as a separate component since it must be a child of solidjs Router
export function TauriRouteListener(props: RouteSectionProps) {
  if (isTauri()) {
    useTauriNavigationEffect();
  }

  return props.children;
}
