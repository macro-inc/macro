import '@fontsource-variable/inter';
import { ProviderSwitcher } from '@app/features/external-view/components/provider-switcher';
import {
  type DesktopSignIn,
  SlackLinkedProvider,
} from '@app/features/slack-linked/context/slack-linked-context';
import { createSlackLinkedCapabilities } from '@app/features/slack-linked/queries/production-capabilities';
import { SlackLinkedPage } from '@app/features/slack-linked/slack-linked-page';
import { createOpenSections } from '@app/features/whatsapp-linked/primitives/open-sections';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { ToastRegion } from '@core/component/Toast/ToastRegion';
import { UserContextProvider, useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { queryClient } from '@queries/client';
import type { ExternalChatProvider } from '@service-storage/generated/schemas/externalChatProvider';
import { Route, Router } from '@solidjs/router';
import { QueryClientProvider } from '@tanstack/solid-query';
import { macroDarkTheme } from '@theme/themes/macro-dark';
import { macroLightTheme } from '@theme/themes/macro-light';
import { themeCssVars } from '@theme/utils/themeCssVars';
import { ImperativeDialogHost } from '@ui';
import { okAsync } from 'neverthrow';
import { createSignal, onMount, Suspense } from 'solid-js';
import { render } from 'solid-js/web';
// The app's styles, so the page and its screenshots look like the app.
import '../../../src/index.css';

declare global {
  interface Window {
    openedChats: string[];
    /** What the stand-in desktop window was opened at. */
    desktopSignIns: (string | undefined)[];
  }
}
window.openedChats = [];
window.desktopSignIns = [];
document.documentElement.dataset.touchDevice = String(isTouchDevice());

/**
 * `?desktop=native` stands in for Macro desktop's Slack window, which a
 * browser can't open: it hands back a fixed session at once.
 */
const nativeDesktop: DesktopSignIn = {
  kind: 'native',
  signIn: (signInUrl) => {
    window.desktopSignIns.push(signInUrl);
    return okAsync({
      cookie: 'xoxd-desktop-cookie',
      cookieDs: '1700000000',
      tokens: [{ token: 'xoxc-desktop-token', teamId: 'T0INITECH' }],
    });
  },
  captcha: () => okAsync('captcha-solution'),
};

/** External's touch provider switcher, as External's touch header shows it. */
function SwitcherHarness() {
  const [selected, setSelected] =
    createSignal<ExternalChatProvider>('whatsapp');
  return (
    <main class="min-h-screen bg-panel p-4 text-ink">
      <ProviderSwitcher
        providers={['whatsapp', 'slack']}
        selected={selected()}
        unread={(provider) => (provider === 'slack' ? 2 : 0)}
        onSelect={setSelected}
      />
      <p>Showing {selected()}</p>
    </main>
  );
}

function Page() {
  onMount(() => {
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    for (const [key, token] of Object.entries(
      themeCssVars(dark ? macroDarkTheme : macroLightTheme)
    ))
      document.documentElement.style.setProperty(key, token);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    document.documentElement.dataset.themeLight = String(!dark);
  });
  const search = new URLSearchParams(location.search);
  if (search.get('view') === 'switcher') return <SwitcherHarness />;
  const production = createSlackLinkedCapabilities({
    openChat: (chatId) => window.openedChats.push(chatId),
    sections: createOpenSections(
      'macro:slack:conversation-sections:v1',
      useUserId()
    ),
  });
  const capabilities =
    search.get('desktop') === 'native'
      ? { ...production, desktop: nativeDesktop }
      : production;
  const login = search.get('slackLogin');
  return (
    <SlackLinkedProvider value={capabilities}>
      <main class="min-h-screen bg-panel p-4 text-ink">
        <SlackLinkedPage
          handoff={login ? { kind: 'login', loginId: login } : undefined}
        />
      </main>
      <ToastRegion />
    </SlackLinkedProvider>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');
render(
  () => (
    <AnalyticsContextProvider>
      <PosthogProvider>
        <QueryClientProvider client={queryClient}>
          <UserContextProvider>
            <Suspense fallback={<p>Loading identity…</p>}>
              <Router
                root={(props) => (
                  <>
                    {props.children}
                    <ImperativeDialogHost />
                  </>
                )}
              >
                <Route path="*" component={Page} />
              </Router>
            </Suspense>
          </UserContextProvider>
        </QueryClientProvider>
      </PosthogProvider>
    </AnalyticsContextProvider>
  ),
  root
);
