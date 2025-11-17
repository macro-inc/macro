import { createEffect, createSignal } from 'solid-js';

export type SettingsTab =
  | 'Account'
  | 'Subscription'
  | 'Organization'
  | 'Appearance'
  | 'Notification'
  | 'Mobile'
  | 'AI Memory';

export const [settingsOpen, setSettingsOpen] = createSignal(false);
export const [activeTabId, setActiveTabId] =
  createSignal<SettingsTab>('Appearance');

export const useSettingsState = () => {
  const openSettings = (activeTabId?: SettingsTab) => {
    setSettingsOpen(true);
    if (activeTabId) setActiveTabId(activeTabId);
  };
  const closeSettings = () => setSettingsOpen(false);
  const toggleSettings = () => {
    const newState = !settingsOpen();
    setSettingsOpen(newState);
  };

  createEffect(() => {
    if (!settingsOpen()) setActiveTabId('Appearance');
  });

  return {
    settingsOpen,
    openSettings,
    closeSettings,
    activeTabId,
    setActiveTabId,
    toggleSettings,
  };
};
