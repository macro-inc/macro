import { usePipedreamMcpFlag } from '@core/pipedream/flag';
import { Show, Suspense } from 'solid-js';
import { IntegrationsSection } from './Integrations';
import { PipedreamIntegrationsSection } from './PipedreamIntegrations';
import { SettingsPage } from './primitives';

/**
 * The agents sidebar's "Connections" page: MCP integrations only. Linking
 * personal accounts (Gmail, GitHub) lives on the Integrations settings tab
 * (see `ConnectedAccounts.tsx`), which keeps this page about what the agent
 * can reach.
 */
export function McpConnections() {
  const pipedreamMcp = usePipedreamMcpFlag();
  return (
    <SettingsPage
      title="Connections"
      description="Connect the tools your team already uses so Macro's agent can work in them."
    >
      <Suspense>
        <Show when={pipedreamMcp()} fallback={<IntegrationsSection />}>
          <PipedreamIntegrationsSection />
        </Show>
      </Suspense>
    </SettingsPage>
  );
}
