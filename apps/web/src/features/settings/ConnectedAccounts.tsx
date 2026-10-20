import { ENABLE_EMAIL } from '@core/constant/featureFlags';
import { useSettingsState } from '@core/constant/SettingsState';
import { useSettingsTabAvailable } from '@core/constant/settingsTabsConfig';
import { lazyNamed } from '@core/util/lazyNamed';
import type { MetaProvider } from '@service-storage/generated/schemas/metaProvider';
import { Button } from '@ui';
import { createSignal, Show, Suspense } from 'solid-js';
import { EmailCard } from './Email';
import { GitHubCard } from './GitHub';
import {
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from './primitives';

const BusinessMessagingSettings = lazyNamed(
  () => import('../meta-messaging/views/account-settings'),
  'BusinessMessagingSettings'
);

const PersonalWhatsAppSettings = lazyNamed(
  () => import('../whatsapp-linked/account-settings'),
  'PersonalWhatsAppSettings'
);

/** Account integrations. Agent tools live in Agent connections. */
export function ConnectedAccounts() {
  const { openSettings } = useSettingsState();
  const isAvailable = useSettingsTabAvailable();
  const [provider, setProvider] = createSignal<MetaProvider>();
  return (
    <Show
      when={provider()}
      keyed
      fallback={
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
              <Suspense>
                <PersonalWhatsAppSettings />
              </Suspense>
              <Suspense>
                <BusinessMessagingSettings
                  onSelectProvider={setProvider}
                  onBack={() => setProvider(undefined)}
                />
              </Suspense>
            </div>
          </SettingsSection>
          <SettingsSection title="Related settings">
            <SettingsCard>
              <Show when={ENABLE_EMAIL}>
                <SettingsRow label="Email accounts and signatures">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openSettings('Email')}
                  >
                    Email settings
                  </Button>
                </SettingsRow>
              </Show>
              <Show when={isAvailable('Calendar')}>
                <SettingsRow label="Calendar connections and colors">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openSettings('Calendar')}
                  >
                    Calendar settings
                  </Button>
                </SettingsRow>
              </Show>
              <SettingsRow label="Apps and tools for agents">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openSettings('Connections')}
                >
                  Agent connections
                </Button>
              </SettingsRow>
            </SettingsCard>
          </SettingsSection>
        </SettingsPage>
      }
    >
      {(selected) => (
        <BusinessMessagingSettings
          provider={selected}
          onSelectProvider={setProvider}
          onBack={() => setProvider(undefined)}
        />
      )}
    </Show>
  );
}
