import { useTauri } from '@macro/tauri';
import { NativeAppPage } from './NativeAppPage';

/** The native app settings page over the Tauri provider's update state. */
export function NativeApp() {
  return <NativeAppPage updates={useTauri()} />;
}
