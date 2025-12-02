import { isTauri } from '@core/util/platform';
import {
  BrowserNotificationModal,
  PlatformNotificationProvider,
} from '@notifications';
import type { RouteSectionProps } from '@solidjs/router';
import { type OsType, type as osType } from '@tauri-apps/plugin-os';
import {
  createContext,
  type JSX,
  useContext,
} from 'solid-js';
import { useTauriNavigationEffect } from './navigation';
import { MaybePushNotificationRegistration } from './PushNotification';

interface TauriContextValue {
  os: OsType;
}

const TauriContext = createContext<TauriContextValue | undefined>(undefined);

function TauriProvider(props: { children: JSX.Element }) {
  const value: TauriContextValue = {
    os: osType(),
  };

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
