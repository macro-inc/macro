import { isTauri } from '@core/util/platform';
import { PlatformNotificationProvider } from '@notifications';
import type { RouteSectionProps } from '@solidjs/router';
import { type OsType, type as osType } from '@tauri-apps/plugin-os';
import {
  type Accessor,
  batch,
  createContext,
  createEffect,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  useContext,
} from 'solid-js';
import { getNetworkInfo } from 'tauri-plugin-device-info-api';
import { getInsets, type Insets } from 'tauri-plugin-safe-area-insets';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useTauriNavigationEffect } from './navigation';
import { MaybePushNotificationRegistration } from './PushNotification';

type NotAndroid = 'not-android';

export type BundleUpdateStatus =
  | { status: 'Idle' }
  | { status: 'CheckingForUpdate' }
  | { status: 'UpdateFound'; data: { version: string; notes: string | null } }
  | { status: 'NoUpdateNeeded' }
  | { status: 'WaitingForWifi' }
  | { status: 'Downloading'; data: { progress: number } }
  | { status: 'Unzipping'; data: { progress: number } }
  | { status: 'Completed' }
  | { status: 'Error'; data: { message: string } };

interface TauriContextValue {
  os: OsType;
  runtimeInsets: Accessor<Insets | NotAndroid>;
  bundleUpdateStatus: Accessor<BundleUpdateStatus>;
  cancelWifiWait: () => void;
}

const TauriContext = createContext<TauriContextValue | undefined>(undefined);

function TauriProvider(props: { children: JSX.Element }) {
  // we only care about this value on android.
  // ios should use the env(safe-area-inset-top) css properties
  // this css is not reliably set on android
  const [insets, setInsets] = createSignal<NotAndroid | Insets>(
    'not-android' as const
  );
  const [bundleUpdateStatus, setBundleUpdateStatus] =
    createSignal<BundleUpdateStatus>({ status: 'Idle' });
  const [waitingForWifi, setWaitingForWifi] = createSignal(false);

  function grantBundleUpdate() {
    invoke('grant_bundle_update', { approved: true }).catch((e) =>
      console.error('[bundle-update] grant_bundle_update failed', e)
    );
  }

  function cancelWifiWait() {
    batch(() => {
      setWaitingForWifi(false);
      setBundleUpdateStatus({ status: 'CheckingForUpdate' });
    });
    grantBundleUpdate();
  }

  const value: TauriContextValue = {
    runtimeInsets: insets,
    os: osType(),
    bundleUpdateStatus,
    cancelWifiWait,
  };

  // When an update is found, only approve the download if we're on wifi/ethernet.
  // On cellular, wait and poll until a suitable connection is available.
  createEffect(() => {
    const status = bundleUpdateStatus();
    if (status.status !== 'UpdateFound') return;

    let aborted = false;
    onCleanup(() => {
      aborted = true;
    });

    console.info('[bundle-update] update found, checking network');
    getNetworkInfo()
      .then((info) => {
        if (aborted) return;
        if (['wifi', 'ethernet'].includes(info.networkType ?? '')) {
          console.info('[bundle-update] network ok, approving download');
          grantBundleUpdate();
        } else {
          console.info('[bundle-update] cellular network, waiting for wifi');
          batch(() => {
            setBundleUpdateStatus({ status: 'WaitingForWifi' });
            setWaitingForWifi(true);
          });
        }
      })
      .catch((e) => {
        if (aborted) return;
        // If network detection fails, allow the download rather than blocking it.
        console.warn(
          '[bundle-update] network check failed, approving download',
          e
        );
        grantBundleUpdate();
      });
  });

  // While waiting for wifi, poll on a 30s interval and on app foreground.
  createEffect(() => {
    if (!waitingForWifi()) return;

    async function tryGrant() {
      try {
        const info = await getNetworkInfo();
        // Re-check after the async gap — cancelWifiWait or a prior tick may have already fired.
        if (!waitingForWifi()) return;
        if (['wifi', 'ethernet'].includes(info.networkType ?? '')) {
          setWaitingForWifi(false);
          console.info('[bundle-update] wifi detected, approving download');
          grantBundleUpdate();
        }
      } catch {
        // Ignore — will retry on next tick.
      }
    }

    const intervalId = setInterval(() => void tryGrant(), 30_000);
    const onVisibilityChange = () => {
      if (!document.hidden) void tryGrant();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    onCleanup(() => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    });
  });

  onMount(() => {
    console.info('[bundle-update] registering listener');
    const unlistenPromise = listen<BundleUpdateStatus>(
      'bundle-update-status',
      (ev) => {
        console.info('[bundle-update] received', JSON.stringify(ev.payload));
        batch(() => {
          setBundleUpdateStatus(ev.payload);
          if (ev.payload.status !== 'WaitingForWifi') setWaitingForWifi(false);
        });
      }
    );
    // Fetch current status since events emitted before the listener registered are missed
    invoke<BundleUpdateStatus>('get_bundle_update_status').then((status) => {
      console.info('[bundle-update] initial status', JSON.stringify(status));
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
  });

  return (
    <TauriContext.Provider value={value}>
      {props.children}
    </TauriContext.Provider>
  );
}

export function MaybeTauriProvider(props: { children: JSX.Element }) {
  if (isTauri()) {
    return (
      <TauriProvider>
        <MaybePushNotificationRegistration>
          {props.children}
        </MaybePushNotificationRegistration>
      </TauriProvider>
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
