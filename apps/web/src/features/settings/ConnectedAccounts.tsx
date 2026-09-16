import { ENABLE_EMAIL } from '@core/constant/featureFlags';
import { usePipedreamMcpFlag } from '@core/pipedream/flag';
import { Show, Suspense } from 'solid-js';
import { EmailCard } from './Email';
import { GitHubCard } from './GitHub';
import { IntegrationsSection } from './Integrations';
import { PipedreamIntegrationsSection } from './PipedreamIntegrations';
import { SettingsPage, SettingsSection } from './primitives';

/**
 * The "Integrations" settings tab: one card per external account the user can
 * link (Gmail, GitHub), followed by the agent's MCP integrations. The agents
 * sidebar has its own MCP-only Connections page (see `McpConnections.tsx`);
 * the MCP section stays here too because deep links (the agent reply's
 * "Connect X" chip, the home hub's setup rows) open this tab to connect an app.
 */
export function ConnectedAccounts() {
  const pipedreamMcp = usePipedreamMcpFlag();
  return (
    <SettingsPage
      title="Integrations"
      description="Connect your accounts so Macro can work across the tools you already use."
    >
      <SettingsSection title="Accounts">
        <div class="flex flex-col gap-3">
          <Show when={ENABLE_EMAIL}>
            <Suspense>
              <EmailCard />
            </Suspense>
          </Show>
          <Suspense>
            <GitHubCard />
          </Suspense>
        </div>
      </SettingsSection>
      <Suspense>
        <Show when={pipedreamMcp()} fallback={<IntegrationsSection />}>
          <PipedreamIntegrationsSection />
        </Show>
      </Suspense>
    </SettingsPage>
  );
}
