import { Show, Suspense } from 'solid-js';
import { Resize } from '@core/component/Resize';
import { isSettingsPanelOpen } from '@core/signal/layout/settings';
import { useIsAuthenticated } from '@core/auth';
import { SettingsPanel } from './Settings';

export const SettingsWrapper = () => {
  const isAuthenticated = useIsAuthenticated();

  return (
    <Show when={isAuthenticated() && isSettingsPanelOpen()}>
      <Resize.Panel
        id="settings-panel"
        minSize={440}
        maxSize={800}
        hidden={() => !isSettingsPanelOpen()}
        persistent={true}
      >
        <Suspense>
          <SettingsPanel hide={!isSettingsPanelOpen()} />
        </Suspense>
      </Resize.Panel>
    </Show>
  );
};
