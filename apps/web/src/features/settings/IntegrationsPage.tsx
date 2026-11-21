import { useSettingsState } from '@core/constant/SettingsState';
import { useSettingsTabAvailable } from '@core/constant/settingsTabsConfig';
import { createSignal, Show } from 'solid-js';
import { IntegrationsView } from './connections/integrations-view';
import { Harness } from './Harness';

/** Personal accounts, team imports and agent tools share one Integrations settings page. */
export function IntegrationsPage() {
  const isTabAvailable = useSettingsTabAvailable();
  const { openSettings } = useSettingsState();
  const [showLocalAgents, setShowLocalAgents] = createSignal(false);
  return (
    <Show
      when={showLocalAgents() && isTabAvailable('Harness')}
      fallback={
        <IntegrationsView
          onOpenEmailSettings={() => openSettings('Email')}
          onOpenMacroMcp={() => openSettings('Agent')}
          onOpenLocalAgents={
            isTabAvailable('Harness')
              ? () => setShowLocalAgents(true)
              : undefined
          }
        />
      }
    >
      <Harness
        onBack={() => setShowLocalAgents(false)}
        backLabel="Integrations"
      />
    </Show>
  );
}
