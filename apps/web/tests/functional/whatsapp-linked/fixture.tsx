import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { ImperativeDialogHost } from '@ui';
import '@fontsource-variable/inter';
import { InMacroSection } from '@app/features/external-view/components/in-macro-section';
import { WhatsAppGroupProvider } from '@app/features/whatsapp-group/context/whatsapp-group-context';
import { createWhatsAppGroupCapabilities } from '@app/features/whatsapp-group/queries/capabilities';
import { whatsappGroupApi } from '@app/features/whatsapp-group/queries/production-api';
import { WhatsAppGroupView } from '@app/features/whatsapp-group/views/whatsapp-group-view';
import { getPermissions } from '@core/component/SharePermissions';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { useUserId } from '@core/context/user';
import { Route, Router } from '@solidjs/router';
import { macroDarkTheme } from '@theme/themes/macro-dark';
import { macroLightTheme } from '@theme/themes/macro-light';
import { themeCssVars } from '@theme/utils/themeColorTokens';
import { onMount, Show, Suspense } from 'solid-js';
// The app's styles, so the page and its screenshots look like the app.
import '../../../src/index.css';
import {
  type PasskeyCapability,
  WhatsAppLinkedProvider,
} from '@app/features/whatsapp-linked/context/whatsapp-linked-context';
import { createWhatsAppLinkedCapabilities } from '@app/features/whatsapp-linked/queries/production-capabilities';
import { WhatsAppPage } from '@app/features/whatsapp-linked/views/whatsapp-page';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { FloatRegionHost } from '@components/app/mobile/float-regions/FloatRegionHost';
import { ToastRegion } from '@core/component/Toast/ToastRegion';
import { UserContextProvider } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { queryClient } from '@queries/client';
import { queryReadyGate } from '@queries/gate';
import { useWhatsappGroupsQuery } from '@queries/whatsapp-groups';
import { QueryClientProvider } from '@tanstack/solid-query';
import { ResultAsync } from 'neverthrow';
import { render } from 'solid-js/web';

declare global {
  interface Window {
    openedGroups: string[];
  }
}
window.openedGroups = [];

/** The production adapter and real queries; only the network is the test's. */
/**
 * `?passkey=native` stands in for Macro desktop's authenticator, which a
 * browser can't run: it shows the caBLE QR event and waits for the phone.
 */
const nativePasskey: PasskeyCapability = {
  kind: 'native',
  authenticate: (_pairingId, _challenge, onEvent) => {
    onEvent({ type: 'qr', value: 'FIDO:/5103963548272401838013624816' });
    return new ResultAsync(new Promise(() => {}));
  },
};

function GroupHarness(props: { groupId: string }) {
  const userId = useUserId();
  const source = createWhatsAppGroupCapabilities(
    whatsappGroupApi,
    () => userId() ?? '',
    () => props.groupId
  );
  const share = useShareModal(() => {
    const group = source.group.data;
    if (!group) return;
    return {
      id: group.id,
      itemType: 'whatsapp_group',
      blockAlias: 'whatsapp_group',
      name: group.name,
      owner: group.ownerId,
      userPermissions: getPermissions(group.accessLevel),
    };
  });
  return (
    <div class="relative h-dvh">
      <ToastRegion />
      {/* The app's bottom chrome host, where the composer floats on touch. */}
      <Show when={isTouchDevice()}>
        <FloatRegionHost />
      </Show>
      <WhatsAppGroupProvider value={source}>
        <WhatsAppGroupView
          userId={userId()}
          onShare={share}
          onConnect={() => {
            location.search = '';
          }}
        />
      </WhatsAppGroupProvider>
    </div>
  );
}

/** External's sidebar section over the real groups query. */
function InMacroHarness() {
  const userId = useUserId();
  const groups = useWhatsappGroupsQuery(whatsappGroupApi, () => userId() ?? '');
  return (
    <main class="w-72 bg-panel p-2 text-ink">
      <InMacroSection
        groups={queryReadyGate(groups) ? groups.data : undefined}
        isPending={groups.isPending}
        isError={groups.isError}
        activeGroupId={undefined}
        open
        onOpenChange={() => {}}
        onOpenGroup={(groupId) => window.openedGroups.push(groupId)}
        onRetry={() => {}}
      />
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
  if (search.get('view') === 'in-macro') return <InMacroHarness />;
  const groupId = search.get('group');
  if (groupId)
    return (
      <Suspense fallback={<p>Loading group…</p>}>
        <GroupHarness groupId={groupId} />
      </Suspense>
    );
  const production = createWhatsAppLinkedCapabilities({
    openGroup: (groupId) => window.openedGroups.push(groupId),
  });
  const capabilities =
    new URLSearchParams(location.search).get('passkey') === 'native'
      ? { ...production, passkey: nativePasskey }
      : production;
  return (
    <WhatsAppLinkedProvider value={capabilities}>
      <main class="min-h-screen bg-panel p-4 text-ink">
        <WhatsAppPage />
      </main>
    </WhatsAppLinkedProvider>
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
              <EmailLinksContextProvider>
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
              </EmailLinksContextProvider>
            </Suspense>
          </UserContextProvider>
        </QueryClientProvider>
      </PosthogProvider>
    </AnalyticsContextProvider>
  ),
  root
);
