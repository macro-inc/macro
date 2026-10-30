import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { ImperativeDialogHost } from '@ui';
import '@fontsource-variable/inter';
import { ExternalChatContextProvider } from '@app/features/external-chat/context/external-chat-context';
import { createExternalChatCapabilities } from '@app/features/external-chat/queries/capabilities';
import { externalChatApi } from '@app/features/external-chat/queries/production-api';
import { ExternalChatView } from '@app/features/external-chat/views/external-chat-view';
import { InMacroChats } from '@app/features/external-view/components/in-macro-section';
import { getPermissions } from '@core/component/SharePermissions';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { useUserId } from '@core/context/user';
import { Route, Router } from '@solidjs/router';
import { macroDarkTheme } from '@theme/themes/macro-dark';
import { macroLightTheme } from '@theme/themes/macro-light';
import { themeCssVars } from '@theme/utils/themeCssVars';
import { onMount, Show, Suspense } from 'solid-js';
// The app's styles, so the page and its screenshots look like the app.
import '../../../src/index.css';
import {
  type PasskeyCapability,
  WhatsAppLinkedProvider,
} from '@app/features/whatsapp-linked/context/whatsapp-linked-context';
import { createOpenSections } from '@app/features/whatsapp-linked/primitives/open-sections';
import { createWhatsAppLinkedCapabilities } from '@app/features/whatsapp-linked/queries/production-capabilities';
import { WhatsAppPage } from '@app/features/whatsapp-linked/views/whatsapp-page';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { FloatRegionHost } from '@components/app/mobile/float-regions/FloatRegionHost';
import { SidePanel } from '@components/app/side-panel';
import { ToastRegion } from '@core/component/Toast/ToastRegion';
import { ChannelsContextProvider } from '@core/context/channels';
import { QuickAccessContextProvider } from '@core/context/quickAccess/context';
import type { QuickAccessContextValue } from '@core/context/quickAccess/types';
import { UserContextProvider } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { queryClient } from '@queries/client';
import { useExternalChatsQuery } from '@queries/external-chats';
import { queryReadyGate } from '@queries/gate';
import { QueryClientProvider } from '@tanstack/solid-query';
import { ResultAsync } from 'neverthrow';
import { render } from 'solid-js/web';

declare global {
  interface Window {
    openedChats: string[];
  }
}
window.openedChats = [];

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

const noQuickAccess: QuickAccessContextValue = {
  useList: () => ({
    error: () => undefined,
    items: () => [],
    totalCount: () => 0,
    hasMore: () => false,
    isLoading: () => false,
    isLoadingMore: () => false,
    loadMore: async () => {},
  }),
  usesRecordSelection: () => false,
  usesSearchProjection: () => false,
  isLoading: () => false,
  refresh: () => {},
  getById: () => undefined,
};

function ChatHarness(props: { chatId: string }) {
  const userId = useUserId();
  const source = createExternalChatCapabilities(
    externalChatApi,
    () => userId() ?? '',
    () => props.chatId
  );
  const share = useShareModal(() => {
    const chat = source.chat.data;
    if (!chat) return;
    return {
      id: chat.id,
      itemType: 'external_chat',
      blockAlias: 'external_chat',
      name: chat.name,
      owner: chat.ownerId,
      userPermissions: getPermissions(chat.accessLevel),
    };
  });
  return (
    <div class="relative h-dvh">
      <ToastRegion />
      {/* The app's bottom chrome host, where the composer floats on touch. */}
      <Show when={isTouchDevice()}>
        <FloatRegionHost />
      </Show>
      <ExternalChatContextProvider value={source}>
        <SidePanel.Root floating defaultOpen={false}>
          <ExternalChatView
            userId={userId()}
            share={
              <ShareTrigger
                onClick={share}
                id={props.chatId}
                blockType="external_chat"
              />
            }
            onShare={share}
            onConnect={() => {
              location.search = '';
            }}
          />
        </SidePanel.Root>
      </ExternalChatContextProvider>
    </div>
  );
}

/** External's sidebar section over the real chats query. */
function InMacroHarness() {
  const userId = useUserId();
  const chats = useExternalChatsQuery(externalChatApi, () => userId() ?? '');
  const sections = createOpenSections(
    'macro:whatsapp:sidebar-sections:v2',
    userId
  );
  return (
    <main class="w-72 bg-panel p-2 text-ink">
      <InMacroChats
        label="WhatsApp"
        chats={queryReadyGate(chats) ? chats.data : undefined}
        isPending={chats.isPending}
        isError={chats.isError}
        activeChatId={undefined}
        isOpen={sections.isOpen}
        onOpenChange={sections.setOpen}
        onOpenChat={(chatId) => window.openedChats.push(chatId)}
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
  const chatId = search.get('chat');
  if (chatId)
    return (
      <Suspense fallback={<p>Loading chat…</p>}>
        <ChatHarness chatId={chatId} />
      </Suspense>
    );
  const production = createWhatsAppLinkedCapabilities({
    openChat: (chatId) => window.openedChats.push(chatId),
    sections: createOpenSections(
      'macro:whatsapp:chat-sections:v2',
      useUserId()
    ),
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
                {/* The app root provides Macro's items; the composer's `@` menu
                    reads them. An external chat offers only its people. */}
                <ChannelsContextProvider>
                  <QuickAccessContextProvider value={noQuickAccess}>
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
                  </QuickAccessContextProvider>
                </ChannelsContextProvider>
              </EmailLinksContextProvider>
            </Suspense>
          </UserContextProvider>
        </QueryClientProvider>
      </PosthogProvider>
    </AnalyticsContextProvider>
  ),
  root
);
