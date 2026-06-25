import { Show, Suspense } from 'solid-js';
import { ENABLE_EMAIL } from '@core/constant/featureFlags';
import { SettingsPage, SettingsSection } from './primitives';
import { EmailCard } from './Email';
import { GitHubCard } from './GitHub';

/**
 * Consolidated "Connected accounts" page: one card per external service the
 * user can link (Gmail, GitHub). Replaces the separate Email / GitHub tabs.
 */
export function ConnectedAccounts() {
  return (
    <SettingsPage
      title="Connected accounts"
      description="Connect your accounts so Macro can work across the tools you already use."
    >
      <SettingsSection>
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
    </SettingsPage>
  );
}
