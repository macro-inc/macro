import { useSettingsState } from '@core/constant/SettingsState';
import { usePipedreamMcpFlag } from '@core/pipedream/flag';
import { Show, Suspense } from 'solid-js';
import { ConnectionsPage } from './connections/ConnectionsPage';
import { IntegrationsSection } from './Integrations';
import { SettingsPage } from './primitives';

/** Agent tool connections. Personal Gmail/GitHub accounts remain in Settings → Integrations. */
export function McpConnections() {
  const pipedreamMcp = usePipedreamMcpFlag();
  const { openSettings } = useSettingsState();
  return (
    <Show
      when={pipedreamMcp()}
      fallback={
        <SettingsPage
          title="Connections"
          description="Connect the tools your team already uses so Macro's agent can work in them."
        >
          <Suspense>
            <IntegrationsSection />
          </Suspense>
        </SettingsPage>
      }
    >
      <ConnectionsPage onOpenMacroMcp={() => openSettings('Agent')} />
    </Show>
  );
}
