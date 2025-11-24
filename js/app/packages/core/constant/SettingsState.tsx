import { createEffect, createSignal } from 'solid-js';
import { isSettingsPanelOpen, useToggleSettingsPanel } from '@core/signal/layout/unifiedPanel';

export type SettingsTab =
  | 'Account'
  | 'Subscription'
  | 'Organization'
  | 'Appearance'
  | 'Mobile'
  | 'AI Memory';

export const [activeTabId, setActiveTabId] =
  createSignal<SettingsTab>('Appearance');
export const [settingsSpotlight, setSettingsSpotlight] = createSignal(false);

export const useSettingsState = () => {
  const toggleSettingsPanel = useToggleSettingsPanel();
  
  const openSettings = (activeTabId?: SettingsTab) => {
    toggleSettingsPanel(true);
    if (activeTabId) setActiveTabId(activeTabId);
  };
  
  const closeSettings = () => {
    toggleSettingsPanel(false);
    setSettingsSpotlight(false);
  };
  
  const toggleSettings = () => {
    toggleSettingsPanel();
  };

  createEffect(() => {
    if (!isSettingsPanelOpen()) {
      setActiveTabId('Appearance');
      setSettingsSpotlight(false);
    }
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