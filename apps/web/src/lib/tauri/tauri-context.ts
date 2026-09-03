import type { OsType } from '@tauri-apps/plugin-os';
import { type Accessor, createContext, useContext } from 'solid-js';
import type { Insets } from 'tauri-plugin-safe-area-insets';

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

export interface TauriContextValue {
  os: OsType;
  runtimeInsets: Accessor<Insets | NotAndroid>;
  bundleUpdateStatus: Accessor<BundleUpdateStatus>;
}

export const TauriContext = createContext<TauriContextValue | undefined>(
  undefined
);

export function useTauri() {
  return useContext(TauriContext);
}

export function useExpectTauri() {
  const res = useTauri();
  if (res === undefined) {
    throw new Error(
      'Tauri Context was not found, did you mean to call useTauri instead?'
    );
  }

  return res;
}
