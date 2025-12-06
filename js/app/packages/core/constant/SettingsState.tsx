import {
  isSettingsPanelOpen,
  setIsSettingsPanelOpen,
  useToggleSettingsPanel,
} from '@core/signal/layout/settings';
import { createEffect, createSignal } from 'solid-js';

export type SettingsTab =
  | 'Account'
  | 'Subscription'
  | 'Organization'
  | 'Appearance'
  | 'Mobile'
  | 'AI Memory'
  | 'Inbox';

export const settingsOpen = isSettingsPanelOpen;
export const setSettingsOpen = setIsSettingsPanelOpen;
export const [activeTabId, setActiveTabId] =
  createSignal<SettingsTab>('Appearance');

export const useSettingsState = () => {
  const toggleSettingsPanel = useToggleSettingsPanel();

  const openSettings = (activeTabId?: SettingsTab) => {
    setIsSettingsPanelOpen(true);
    if (activeTabId) setActiveTabId(activeTabId);
  };
  const closeSettings = () => setIsSettingsPanelOpen(false);
  const toggleSettings = () => toggleSettingsPanel();

  createEffect(() => {
    if (!isSettingsPanelOpen()) setActiveTabId('Appearance');
  });

  return {
    settingsOpen: isSettingsPanelOpen,
    openSettings,
    closeSettings,
    activeTabId,
    setActiveTabId,
    toggleSettings,
  };
};
