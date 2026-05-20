import { useSplitLayout } from '@app/component/split-layout/layout';
import { globalSplitManager } from '@app/signal/splitLayout';
import { createMemo, createSignal } from 'solid-js';

export type SettingsTab =
  | 'Subscription'
  | 'Organization'
  | 'Appearance'
  | 'Mobile'
  | 'AI Memory'
  | 'Inbox'
  | 'Shortcuts'
  | 'Keyboard Shortcuts'
  | 'Account & Team'
  | 'Mobile & MCPs';

export const [activeTabId, setActiveTabId] =
  createSignal<SettingsTab>('Appearance');

export type AgentSettingsSubTab = 'connectors' | 'mcp_server';
export const [agentSettingsSubTab, setAgentSettingsSubTab] =
  createSignal<AgentSettingsSubTab>('connectors');

export const useSettingsState = () => {
  const { openWithSplit } = useSplitLayout();

  const getSettingsSplit = () => {
    const splitManager = globalSplitManager();
    if (!splitManager) return undefined;
    return splitManager.splits().find((split) => {
      const content = split.content;
      return content.type === 'component' && content.id === 'settings';
    });
  };

  const isOpen = createMemo(() => {
    return getSettingsSplit() !== undefined;
  });

  const openSettings = (activeTabId?: SettingsTab) => {
    if (activeTabId) setActiveTabId(activeTabId);
    openWithSplit({ type: 'component', id: 'settings' }, { activate: true });
  };

  const closeSettings = () => {
    const settingsSplit = getSettingsSplit();
    if (settingsSplit) {
      const splitManager = globalSplitManager();
      splitManager?.removeSplit(settingsSplit.id);
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
