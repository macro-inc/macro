import { useSplitLayout } from '@app/component/split-layout/layout';
import { globalSplitManager } from '@app/signal/splitLayout';
import { createMemo, createSignal } from 'solid-js';

export type SettingsTab =
  | 'Account'
  | 'Subscription'
  | 'Organization'
  | 'Appearance'
  | 'Mobile'
  | 'AI Memory'
  | 'Inbox'
  | 'Shortcuts'
  | 'Mobile App'
  | 'Agent'
  | 'Team';

export const [activeTabId, setActiveTabId] =
  createSignal<SettingsTab>('Appearance');

export type AgentSettingsSubTab = 'connectors' | 'mcp_server';
export const [agentSettingsSubTab, setAgentSettingsSubTab] =
  createSignal<AgentSettingsSubTab>('connectors');

export const useSettingsState = () => {
  const { insertSplit } = useSplitLayout();

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
    if (isOpen()) return; // Already open
    insertSplit({ type: 'component', id: 'settings' });
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
