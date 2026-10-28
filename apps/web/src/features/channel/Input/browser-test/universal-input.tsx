import '@app/index.css';
import { MobileSettingsProvider } from '@app/features/settings/context/mobile-settings';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { ChannelsContextProvider } from '@core/context/channels';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { QuickAccessProvider } from '@core/context/quickAccess/QuickAccessProvider';
import { UserContextProvider } from '@core/context/user';
import { useHotKeyRoot } from '@core/hotkey/hotkeys';
import { EntityProvider } from '@entity';
import { authKeys } from '@queries/auth/keys';
import type { UserInfoData } from '@queries/auth/user-info';
import { queryClient } from '@queries/client';
import { Route, Router } from '@solidjs/router';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { ChannelInput } from '../ChannelInput';

const channelId = 'universal-input-fixture-channel';

/** Identity is cached rather than fetched; the fixture answers no auth calls. */
const user: UserInfoData = {
  id: 'universal-input-fixture-user',
  userId: 'universal-input-fixture-user',
  authenticated: true,
  email: 'composer@example.com',
  name: 'Composer Fixture',
  permissions: [],
  licenseStatus: 'active',
  tutorialComplete: true,
  group: null,
  hasChromeExt: false,
  hasTrialed: false,
  aiDataConsent: true,
  referralCode: 'fixture',
  createdAt: null,
};

/**
 * The real channel composer with Universal Input enabled, over the app shell's
 * providers. Inference and every destination write are blocked at the network,
 * so the offer, the form and the keys are exercised without a backend.
 */
function Fixture() {
  useHotKeyRoot();
  // `EntityProvider` supplies the app's shared client to everything below it,
  // so identity is seeded there rather than into a fixture-local one.
  queryClient.setQueryData(authKeys.userInfo.queryKey, user);
  const [sent, setSent] = createSignal(0);
  return (
    <AnalyticsContextProvider>
      <PosthogProvider>
        <EntityProvider>
          <UserContextProvider>
            <ChannelsContextProvider>
              <EmailLinksContextProvider>
                <QuickAccessProvider>
                  <MobileSettingsProvider>
                    <main class="flex min-h-screen flex-col justify-end bg-page p-4 text-ink">
                      <output class="sr-only" data-testid="messages-sent">
                        {sent()}
                      </output>
                      <ChannelInput
                        autofocus
                        universalInput
                        input={{
                          mode: 'channel',
                          id: `channel-input-${channelId}`,
                          placeholder: 'Message #universal-input-fixture',
                        }}
                        participants={() => []}
                        bots={() => []}
                        onSend={() => {
                          setSent((count) => count + 1);
                        }}
                      />
                    </main>
                  </MobileSettingsProvider>
                </QuickAccessProvider>
              </EmailLinksContextProvider>
            </ChannelsContextProvider>
          </UserContextProvider>
        </EntityProvider>
      </PosthogProvider>
    </AnalyticsContextProvider>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Fixture root missing');
render(
  () => (
    <Router>
      <Route path="*" component={Fixture} />
    </Router>
  ),
  root
);
