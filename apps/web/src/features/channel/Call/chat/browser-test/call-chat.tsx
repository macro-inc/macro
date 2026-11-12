import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { ChannelsContextProvider } from '@core/context/channels';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { QuickAccessProvider } from '@core/context/quickAccess/QuickAccessProvider';
import { UserContextProvider } from '@core/context/user';
import { useHotKeyRoot } from '@core/hotkey/hotkeys';
import { EntityProvider } from '@entity';
import { MaybeTauriProvider } from '@macro/tauri';
import { authKeys, type UserInfoData } from '@queries/auth/user-info';
import { queryClient } from '@queries/client';
import { Router } from '@solidjs/router';
import { QueryClientProvider } from '@tanstack/solid-query';
import { ErrorBoundary } from 'solid-js';
import { render } from 'solid-js/web';
import { CallProvider } from '../../CallContext';
import CallChat from '../CallChat';

// A signed-in viewer, without a session: nothing here reaches a real account.
queryClient.setQueryData(authKeys.userInfo.queryKey, {
  authenticated: true,
  id: 'macro|me@example.com',
  permissions: [],
} as unknown as UserInfoData);

const CALL_ID = '00000000-0000-7000-8000-0000000ca110';

/**
 * A call's own chat as a meeting page mounts it: under the providers every
 * page gets (`routes/Root.tsx`), without `AppProviders`.
 */
function Fixture() {
  useHotKeyRoot();
  return (
    <QueryClientProvider client={queryClient}>
      <MaybeTauriProvider>
        <AnalyticsContextProvider>
          <PosthogProvider>
            <EntityProvider>
              <UserContextProvider>
                <EmailLinksContextProvider>
                  <ChannelsContextProvider>
                    <CallProvider>
                      <QuickAccessProvider>
                        <Router root={MeetingPanel}>{[]}</Router>
                      </QuickAccessProvider>
                    </CallProvider>
                  </ChannelsContextProvider>
                </EmailLinksContextProvider>
              </UserContextProvider>
            </EntityProvider>
          </PosthogProvider>
        </AnalyticsContextProvider>
      </MaybeTauriProvider>
    </QueryClientProvider>
  );
}

function MeetingPanel() {
  return (
    <main class="flex h-screen min-h-0 flex-col bg-page text-ink">
      <div
        class="mx-auto flex min-h-0 w-full max-w-[372px] flex-1 flex-col bg-surface-2"
        data-testid="call-chat"
      >
        <ErrorBoundary
          fallback={(error) => <p role="alert">{String(error)}</p>}
        >
          <CallChat
            callId={CALL_ID}
            open
            focusOnOpen={false}
            onClose={() => {}}
          />
        </ErrorBoundary>
      </div>
    </main>
  );
}

const root = document.getElementById('root');
if (root) render(() => <Fixture />, root);
