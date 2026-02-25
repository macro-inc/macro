import { useSplitLayout } from '@app/component/split-layout/layout';
import { globalSplitManager } from '@app/signal/splitLayout';
import { isMobile } from '@core/mobile/isMobile';
import {
  isSettingsPanelOpen,
  setIsSettingsPanelOpen,
} from '@core/signal/layout/settings';
import { createSignal } from 'solid-js';

export type SettingsTab =
  | 'Account'
  | 'Subscription'
  | 'Organization'
  | 'Appearance'
  | 'Mobile'
  | 'AI Memory'
  | 'Inbox'
  | 'Shortcuts';

export const settingsOpen = isSettingsPanelOpen;
export const setSettingsOpen = setIsSettingsPanelOpen;
export const [activeTabId, setActiveTabId] =
  createSignal<SettingsTab>('Appearance');

export const useSettingsState = () => {
  const { replaceSplit } = useSplitLayout();

  const activeSplit = () => {
    const splitManager = globalSplitManager();
    const activeSplitId = splitManager?.activeSplitId();
    return activeSplitId ? splitManager?.getSplit(activeSplitId) : undefined;
  };

  const splitContent = () => {
    return activeSplit()?.content();
  };

  const isOpen = () => {
    if (isMobile()) {
      const content = splitContent();
      return content?.type === 'component' && content?.id === 'settings';
    } else {
      return isSettingsPanelOpen();
    }
  };

  const openSettings = (activeTabId?: SettingsTab) => {
    if (isMobile()) {
      replaceSplit({ content: { type: 'component', id: 'settings' } });
    } else {
      setIsSettingsPanelOpen(true);
    }
    if (activeTabId) setActiveTabId(activeTabId);
  };
  const closeSettings = () => {
    if (isMobile()) {
      if (isOpen()) {
        activeSplit()?.goBack();
      }
    } else {
      setIsSettingsPanelOpen(false);
    }
  };
  const toggleSettings = () => {
    if (isOpen()) closeSettings();
    else openSettings();
  };

  return {
    settingsOpen: isOpen,
    openSettings,
    closeSettings,
    activeTabId,
    setActiveTabId,
    toggleSettings,
  };
};
