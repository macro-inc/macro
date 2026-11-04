import '@app/index.css';
import { PersistedReview } from '@app/features/agent-reviews/views/persisted-review';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { ChannelsContextProvider } from '@core/context/channels';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { QuickAccessProvider } from '@core/context/quickAccess/QuickAccessProvider';
import { UserContextProvider } from '@core/context/user';
import {
  attachGlobalDOMScope,
  registerHotkey,
  useHotKeyRoot,
} from '@core/hotkey/hotkeys';
import { EntityProvider } from '@entity';
import { queryClient } from '@queries/client';
import { QueryClientProvider } from '@tanstack/solid-query';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';

/**
 * A saved agent email review, polled from the routed review API, beside the
 * app's global Create hotkey. Typing that escapes the draft presses `c`.
 */
function Fixture() {
  useHotKeyRoot();
  attachGlobalDOMScope(document.body);
  const [created, setCreated] = createSignal(0);
  registerHotkey({
    hotkey: 'c',
    scopeId: 'global',
    description: 'Create',
    keyDownHandler: () => {
      setCreated((count) => count + 1);
      return true;
    },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <AnalyticsContextProvider>
        <PosthogProvider>
          <EntityProvider>
            <UserContextProvider>
              <EmailLinksContextProvider>
                <ChannelsContextProvider>
                  <QuickAccessProvider>
                    <main class="min-h-screen bg-surface p-4 text-ink">
                      <PersistedReview
                        sessionId="019a0000-0000-7000-8000-000000000001"
                        reviewId="019a0000-0000-7000-8000-000000000005"
                        canAct
                      />
                      <output data-testid="created">{created()}</output>
                    </main>
                  </QuickAccessProvider>
                </ChannelsContextProvider>
              </EmailLinksContextProvider>
            </UserContextProvider>
          </EntityProvider>
        </PosthogProvider>
      </AnalyticsContextProvider>
    </QueryClientProvider>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Fixture root missing');
render(() => <Fixture />, root);
