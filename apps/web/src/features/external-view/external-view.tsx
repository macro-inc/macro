import { ViewShell, ViewSidebar } from '@app/components/view-shell';
import {
  SplitRouter,
  useNavigate,
  useParams,
  useRouteState,
} from '@app/lib/split-router';
import { externalChatRoute, externalRoute } from '@app/routes/routes';
import { useSplitDisplayName } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { useExternalChatsQuery } from '@queries/external-chats';
import { useExternalChatListsSync } from '@queries/external-chats/sync';
import { queryReadyGate } from '@queries/gate';
import { traceLoad } from '@queries/whatsapp-linked/operation';
import type { ExternalChatProvider } from '@service-storage/generated/schemas/externalChatProvider';
import { useSearchParams } from '@solidjs/router';
import { createSignal, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { providerIdentity } from '../external-chat/providers/identity';
import { externalChatApi } from '../external-chat/queries/production-api';
import { createOpenSections } from '../whatsapp-linked/primitives/open-sections';
import { InMacroChats, UnreadCount } from './components/in-macro-section';
import { selectedProvider } from './core/selection';
import { useEnabledProviders } from './provider-flags';
import { handedOffProvider, PROVIDER_PAGES } from './provider-pages';

/**
 * External: accounts on outside messaging apps that bring conversations into
 * Macro, one sidebar entry per provider whose flag is on. The main pane shows
 * the selected provider's account page (the first one until another is
 * picked); chats in Macro open there at `/external/chat/:chatId`, and on
 * touch the list drills into the chat.
 */
export function ExternalView() {
  useSplitDisplayName(() => 'External');
  const enabled = useEnabledProviders();
  const providers = () => enabled().providers;
  // The route names the provider to show (a sidebar click, Back from a
  // chat, an account notification); the latest navigation wins. A desktop
  // deep link names it by its param instead, read once as the page drops it.
  const routed = useRouteState(externalRoute);
  const [search] = useSearchParams();
  const handedOff = handedOffProvider(search);
  const selected = () =>
    selectedProvider(routed()?.provider ?? handedOff, providers());

  useExternalChatListsSync();
  const userId = useUserId();
  const chats = useExternalChatsQuery(externalChatApi, () => userId() ?? '');
  const inMacro = () => (queryReadyGate(chats) ? chats.data : undefined);
  const providerChats = (provider: ExternalChatProvider) =>
    inMacro()?.filter((chat) => chat.provider === provider);
  traceLoad('external_chat.list.load', () => {
    if (chats.isError) return { outcome: 'error' };
    const list = inMacro();
    if (!list) return;
    return {
      outcome: 'success',
      attrs: {
        'external_chat.count': list.length,
        'external_chat.unread': list.filter((chat) => chat.unreadCount).length,
      },
    };
  });

  const params = useParams<{ chatId?: string }>();
  const navigate = useNavigate();
  const openChat = (chatId: string) =>
    fireAndForget(
      navigate({ route: externalChatRoute, params: { chatId } }),
      'external-view'
    );
  const openProvider = (provider: ExternalChatProvider) =>
    fireAndForget(
      navigate({ route: externalRoute, params: {} }, { state: { provider } }),
      'external-view'
    );
  const [folded, setFolded] = createSignal<ExternalChatProvider[]>([]);
  const toggleFolded = (provider: ExternalChatProvider) =>
    setFolded((current) =>
      current.includes(provider)
        ? current.filter((item) => item !== provider)
        : [...current, provider]
    );
  const sections = createOpenSections(
    'macro:whatsapp:sidebar-sections:v2',
    userId
  );
  const inMacroChats = (provider: ExternalChatProvider) => (
    <InMacroChats
      label={providerIdentity(provider).label}
      chats={providerChats(provider)}
      isPending={chats.isPending}
      isError={chats.isError}
      activeChatId={params.chatId}
      isOpen={sections.isOpen}
      onOpenChange={sections.setOpen}
      onOpenChat={openChat}
      onRetry={() => fireAndForget(chats.refetch(), 'external-view')}
    />
  );
  const unread = (provider: ExternalChatProvider) =>
    (providerChats(provider) ?? []).reduce(
      (sum, chat) => sum + chat.unreadCount,
      0
    );

  // Touch has no sidebar: the chats in Macro lead the page.
  const touchInMacro = () => (
    <Show when={isTouchDevice()}>
      <section aria-labelledby="external-chats" class="px-2">
        <h2
          id="external-chats"
          class="px-2 pt-4 pb-1 text-xs font-semibold tracking-tight text-ink-extra-muted"
        >
          In Macro
        </h2>
        <For each={providers()}>{(provider) => inMacroChats(provider)}</For>
      </section>
    </Show>
  );
  const providerPage = () => (
    <Show when={selected()}>
      {(provider) => (
        <Dynamic
          component={PROVIDER_PAGES[provider()]}
          inMacro={touchInMacro()}
        />
      )}
    </Show>
  );

  return (
    <SplitPanel.Root>
      <SplitPanel.Body>
        <ViewShell.Root
          asidePreferenceKey="external"
          aside={isTouchDevice() ? false : undefined}
          resizable={!isTouchDevice()}
        >
          <ViewShell.Aside>
            <ViewSidebar.Root aria-label="External navigation">
              <ViewSidebar.Header>
                <div class="flex min-w-0 items-center gap-1">
                  <ViewSidebar.CloseButton class="shrink-0" />
                  <ViewSidebar.Title>External</ViewSidebar.Title>
                </div>
              </ViewSidebar.Header>
              <ViewSidebar.Content>
                <ViewSidebar.Nav aria-label="External apps">
                  <For each={providers()}>
                    {(provider) => {
                      const open = () => !folded().includes(provider);
                      return (
                        <>
                          <ViewSidebar.TreeItem
                            active={!params.chatId && selected() === provider}
                            label={providerIdentity(provider).label}
                            expanded={open()}
                            onToggle={() => toggleFolded(provider)}
                            onClick={() => openProvider(provider)}
                          >
                            <ViewSidebar.Icon>
                              <Dynamic
                                component={providerIdentity(provider).icon}
                              />
                            </ViewSidebar.Icon>
                            <span class="min-w-0 flex-1 truncate">
                              {providerIdentity(provider).label}
                            </span>
                            <Show when={!open()}>
                              <UnreadCount count={unread(provider)} />
                            </Show>
                          </ViewSidebar.TreeItem>
                          <ViewSidebar.Branch open={open()}>
                            {inMacroChats(provider)}
                          </ViewSidebar.Branch>
                        </>
                      );
                    }}
                  </For>
                </ViewSidebar.Nav>
              </ViewSidebar.Content>
            </ViewSidebar.Root>
          </ViewShell.Aside>
          <ViewShell.Main>
            <SplitRouter.Outlet fallback={providerPage} />
          </ViewShell.Main>
        </ViewShell.Root>
      </SplitPanel.Body>
    </SplitPanel.Root>
  );
}
