import { Show } from 'solid-js';
import { Resize } from '@core/component/Resize';
import { isSettingsPanelOpen, useToggleSettingsPanel } from '@core/signal/layout/settings';
import { useIsAuthenticated } from '@core/auth';
import { registerHotkey } from 'core/hotkey/hotkeys';
import { SettingsPanel } from './Settings';

export const SettingsWrapper = () => {
  const isAuthenticated = useIsAuthenticated();
  const toggleSettingsPanel = useToggleSettingsPanel();

  // Register escape hotkey to close settings
  registerHotkey({
    scopeId: 'settings',
    hotkey: 'escape',
    condition: () => Boolean(isSettingsPanelOpen()),
    description: 'Close settings',
    keyDownHandler: () => {
      toggleSettingsPanel(false);
      return true;
    },
  });

  return (
    <Show when={isAuthenticated()}>
      <Resize.Panel
        id="settings-panel"
        minSize={440}
        maxSize={800}
        hidden={() => !isSettingsPanelOpen()}
        persistent={true}
      >
        <SettingsPanel />
      </Resize.Panel>
    </Show>
  );
};
