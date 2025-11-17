import { createEffect, createMemo, createSignal } from 'solid-js';
import { useSplitLayout } from '@app/component/split-layout/layout';
import { globalSplitManager } from '@app/signal/splitLayout';

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

export const useSettingsState = () => {
  const { replaceOrInsertSplit } = useSplitLayout();

  const settingsOpen = createMemo(() => {
    const splitManager = globalSplitManager();
    if (!splitManager) return false;
    const settingsSplit = splitManager.getSplitByContent('component', 'settings');
    return settingsSplit !== undefined;
  });

  const openSettings = (activeTabId?: SettingsTab) => {
    if (activeTabId) setActiveTabId(activeTabId);
    replaceOrInsertSplit({
      type: 'component',
      id: 'settings',
    });
  };

  const closeSettings = () => {
    const splitManager = globalSplitManager();
    if (!splitManager) return;
    const settingsSplit = splitManager.getSplitByContent('component', 'settings');
    settingsSplit?.close();
  };

  const toggleSettings = () => {
    if (settingsOpen()) {
      closeSettings();
    } else {
      openSettings();
    }
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
