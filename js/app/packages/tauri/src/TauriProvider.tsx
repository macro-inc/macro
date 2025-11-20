import {
  BrowserNotificationModal,
  PlatformNotificationProvider,
} from '@notifications';
import type { RouteSectionProps } from '@solidjs/router';
import { type OsType, type as osType } from '@tauri-apps/plugin-os';
import { isTauri } from 'core/util/platformFetch';
import {
  type Accessor,
  createContext,
  createSignal,
  type JSX,
  onMount,
  useContext,
} from 'solid-js';
import { getInsets, type Insets } from 'tauri-plugin-safe-area-insets';
import { useTauriNavigationEffect } from './navigation';
import { MaybePushNotificationRegistration } from './PushNotification';

export { isTauri };

type NotAndroid = 'not-android';

interface TauriContextValue {
  os: OsType;
  runtimeInsets: Accessor<Insets | NotAndroid>;
}

const TauriContext = createContext<TauriContextValue | undefined>(undefined);

function TauriProvider(props: { children: JSX.Element }) {
  // we only care about this value on android.
  // ios should use the env(safe-area-inset-top) css properties
  // this css is not reliably set on android
  const [insets, setInsets] = createSignal<NotAndroid | Insets>(
    'not-android' as const
  );

  const value: TauriContextValue = {
    runtimeInsets: insets,
    os: osType(),
  };

  onMount(() => {
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
      <BrowserNotificationModal />
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
