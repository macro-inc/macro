import { setSettingsOpened } from './fixture-state';

export function useSettingsState() {
  return {
    openSettings: (tab?: string) => setSettingsOpened(tab ?? 'Settings'),
    closeSettings: () => {},
  };
}
