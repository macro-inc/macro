import { ENABLE_EMAIL } from '@core/constant/featureFlags';
import { Show, Suspense } from 'solid-js';
import { EmailCard } from './Email';
import { GitHubCard } from './GitHub';
import { IntegrationsSection } from './Integrations';
import { SettingsPage, SettingsSection } from './primitives';

/**
 * Consolidated "Connections" page: one card per external account the user can
 * link (Gmail, GitHub), plus the agent's MCP integrations — so everything
 * Macro is connected to lives in one place.
 */
export function ConnectedAccounts() {
  return (
    <SettingsPage
      title="Connections"
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
        <IntegrationsSection />
      </Suspense>
    </SettingsPage>
  );
}
