// Everything else the app imports from it is the real module's.
export * from '../../../../../lib/core/constant/SettingsState';

import { setSettingsOpened } from './fixture-state';

export function useSettingsState() {
  return {
    openSettings: (tab?: string) => setSettingsOpened(tab ?? 'Settings'),
    closeSettings: () => {},
  };
}
