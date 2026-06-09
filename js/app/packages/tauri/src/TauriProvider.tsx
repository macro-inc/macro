import { NativeCallProvider, useCallKitSetup } from '@channel/Call';
import { NativeAppUpdateRequiredDialog } from '@core/mobile/NativeAppUpdateRequiredDialog';
import { isPlatform, isTauri } from '@core/util/platform';
import { PlatformNotificationProvider } from '@notifications';
import type { RouteSectionProps } from '@solidjs/router';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { type OsType, type as osType } from '@tauri-apps/plugin-os';
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
import { getInsets, type Insets } from 'tauri-plugin-safe-area-insets';
import { useTauriNavigationEffect } from './navigation';
import { MaybePushNotificationRegistration } from './PushNotification';
import { ShareTargetProvider } from './ShareTargetProvider';

type NotAndroid = 'not-android';

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
  runtimeInsets: Accessor<Insets | NotAndroid>;
  bundleUpdateStatus: Accessor<BundleUpdateStatus>;
}

const TauriContext = createContext<TauriContextValue | undefined>(undefined);

function shouldShowNativeAppUpdateRequiredDialog(status: BundleUpdateStatus) {
  return (
    status.status === 'ClearRequired' ||
    status.status === 'NativeUpdateRequired'
  );
}

function TauriProvider(props: { children: JSX.Element }) {
  // we only care about this value on android.
  // ios should use the env(safe-area-inset-top) css properties
  // this css is not reliably set on android
  const [insets, setInsets] = createSignal<NotAndroid | Insets>('not-android');
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
    runtimeInsets: insets,
    os: osType(),
    bundleUpdateStatus,
  };

  onMount(() => {
    const unlistenPromise = listen<BundleUpdateStatus>(
      'bundle-update-status',
      (ev) => {
        setBundleUpdateStatus(ev.payload);
      }
    );
    invoke<boolean>('ack_bundle_update_reload').catch((e) =>
      console.error('[bundle-update] ack_bundle_update_reload failed', e)
    );
    // Fetch current status since events emitted before the listener registered are missed
    invoke<BundleUpdateStatus>('get_bundle_update_status').then((status) => {
      setBundleUpdateStatus(status);
    });
    onCleanup(() => {
      unlistenPromise.then((unlisten) => unlisten());
    });

    if (value.os === 'android') {
      getInsets().then((insets) => {
        setInsets(insets);
        // Set CSS variables for Tauri insets
        document.documentElement.style.setProperty(
          '--tauri-inset-top',
          `${insets.top}px`
        );
        document.documentElement.style.setProperty(
          '--tauri-inset-bottom',
          `${insets.bottom}px`
        );
        document.documentElement.style.setProperty(
          '--tauri-inset-left',
          `${insets.left}px`
        );
        document.documentElement.style.setProperty(
          '--tauri-inset-right',
          `${insets.right}px`
        );
      });
    }

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
      <NativeAppUpdateRequiredDialog
        open={nativeAppUpdateRequiredDialogOpen()}
        onClose={() => setNativeAppUpdateRequiredDialogOpen(false)}
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
