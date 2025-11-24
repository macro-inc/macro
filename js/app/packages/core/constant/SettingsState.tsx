import { createEffect, createSignal } from 'solid-js';
import { setIsRightPanelOpen } from '@core/signal/layout';
import { setIsSettingsPanelOpen, isSettingsPanelOpen } from '@core/signal/layout';

export type SettingsTab =
  | 'Account'
  | 'Subscription'
  | 'Organization'
  | 'Appearance'
  | 'Notification'
  | 'Mobile'
  | 'AI Memory';

export const [activeTabId, setActiveTabId] =
  createSignal<SettingsTab>('Appearance');
export const [settingsSpotlight, setSettingsSpotlight] = createSignal(false);

export const useSettingsState = () => {
  const openSettings = (activeTabId?: SettingsTab) => {
    // Close right panel when opening settings
    setIsRightPanelOpen(false);
    setIsSettingsPanelOpen(true);
    if (activeTabId) setActiveTabId(activeTabId);
  };
  
  const closeSettings = () => {
    setIsSettingsPanelOpen(false);
    setSettingsSpotlight(false);
  };
  
  const toggleSettings = () => {
    const newState = !isSettingsPanelOpen();
    if (newState) {
      // Close right panel when opening settings
      setIsRightPanelOpen(false);
    }
    setIsSettingsPanelOpen(newState);
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