import { openPanel, setOpenPanel, useToggleRightPanel, useToggleSettingsPanel } from '@core/signal/layout/unifiedPanel';
import { settingsSpotlight, setSettingsSpotlight } from '@core/constant/SettingsState';
import { SplitlikeContainer } from './split-layout/components/SplitContainer';
import { Show, createEffect, createSignal } from 'solid-js';
import { registerHotkey } from 'core/hotkey/hotkeys';
import { Resize } from '@core/component/Resize';
import { useIsAuthenticated } from '@core/auth';
import { TOKENS } from '@core/hotkey/tokens';

import { RightbarContent } from './rightbar/Rightbar';
import { SettingsContent } from './settings/Settings';

export function UnifiedPanelWrapper() {
  const isAuthenticated = useIsAuthenticated();
  const toggleRightPanel = useToggleRightPanel();
  const toggleSettingsPanel = useToggleSettingsPanel();


  const [panelSpotlight, setPanelSpotlight] = createSignal(false);

  createEffect(() => {
    if (openPanel() === 'settings') {
      setPanelSpotlight(settingsSpotlight());
    }
  });

  createEffect(() => {
    if (openPanel() === 'settings' && !panelSpotlight()) {
      setSettingsSpotlight(false);
    }
  });

  const handleSetSpotlight = (value: boolean | ((prev: boolean) => boolean)) => {
    const newValue = typeof value === 'function' ? value(panelSpotlight()) : value;
    setPanelSpotlight(newValue);
    if (openPanel() === 'settings') {
      setSettingsSpotlight(newValue);
    }
  };

  const attachHotkeys = (element: HTMLElement) => {
    const scopeId = 'unified-panel';

    registerHotkey({
      condition: () => Boolean(panelSpotlight() || openPanel()),
      hotkeyToken: TOKENS.global.toggleRightPanel,
      description: 'Close panel',
      runWithInputFocused: true,
      hotkey: 'escape',
      scopeId,

      keyDownHandler: () => {
        if(panelSpotlight()){
          setPanelSpotlight(false);
          setSettingsSpotlight(false);
        }
        else{
          setOpenPanel(null);
        }
        return true;
      },
    });

    // Settings hotkey (cmd+;)
    registerHotkey({
      hotkeyToken: TOKENS.global.toggleSettings,
      hotkey: 'cmd+;',
      scopeId: 'global',
      description: () => {
        return openPanel() === 'settings' ? 'Close Settings Panel' : 'Open Settings Panel';
      },
      keyDownHandler: () => {
        toggleSettingsPanel();
        return true;
      },
      runWithInputFocused: true,
    });

    // Rightbar hotkey (cmd+/)
    registerHotkey({
      hotkey: 'cmd+/',
      hotkeyToken: TOKENS.global.toggleRightPanel,
      scopeId: 'global',
      condition: () => Boolean(isAuthenticated()),
      description: () => {
        return openPanel() === 'rightbar' ? 'Close AI Chat' : 'Open AI Chat';
      },
      keyDownHandler: () => {
        toggleRightPanel();
        return true;
      },
    });
  };

  const isPanelOpen = () => openPanel() !== null;
  const currentPanelType = () => openPanel();

  return (
    <Show when={isAuthenticated()}>
      <Resize.Panel
        hidden={() => !isPanelOpen()}
        id="unified-panel"
        maxSize={1200}
        minSize={400}
      >
        <div
          classList={{
            visible: isPanelOpen() || panelSpotlight(),
          }}
          class="size-full invisible"
          ref={(r) => {
            attachHotkeys(r);
          }}
        >
          <SplitlikeContainer
            setSpotlight={handleSetSpotlight}
            spotlight={panelSpotlight}
            tr={!panelSpotlight()}
          >
            <Show when={currentPanelType() === 'rightbar'}>
              <RightbarContent />
            </Show>
            <Show when={currentPanelType() === 'settings'}>
              <SettingsContent />
            </Show>
          </SplitlikeContainer>
        </div>
      </Resize.Panel>
    </Show>
  );
}
