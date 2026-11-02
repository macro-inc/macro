import { ViewShell, ViewSidebar } from '@app/components/view-shell';
import { SplitRouter, useNavigate, useParams } from '@app/lib/split-router';
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
import { ExternalChatProvider } from '@service-storage/generated/schemas/externalChatProvider';
import { useSearchParams } from '@solidjs/router';
import { createSignal, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { z } from 'zod';
import { providerIdentity } from '../external-chat/providers/identity';
import { externalChatApi } from '../external-chat/queries/production-api';
import { createOpenSections } from '../whatsapp-linked/primitives/open-sections';
import { WhatsAppLinked } from '../whatsapp-linked/whatsapp-linked';
import { InMacroChats, UnreadCount } from './components/in-macro-section';

const PROVIDERS = Object.values(ExternalChatProvider);

/**
 * External: accounts on outside messaging apps that bring conversations into
 * Macro, one sidebar entry per provider. Chats in Macro open in the main pane
 * at `/external/chat/:chatId`; on touch the list drills into the chat.
 * WhatsApp is the only provider today, so its account page is the default.
 */
export function ExternalView() {
  useSplitDisplayName(() => 'External');
  // Read once: the pairing id is consumed, then dropped from the URL.
  const [search, setSearch] = useSearchParams();
  const handedOffPairing = z.uuid().safeParse(search.whatsappPairing).data;
  if (search.whatsappPairing !== undefined)
    setSearch({ whatsappPairing: undefined }, { replace: true });

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
  const openWhatsApp = () =>
    fireAndForget(
      navigate({ route: externalRoute, params: {} }),
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

  const whatsappPage = () => (
    <>
      <ViewShell.TopBar>
        <h1 class="min-w-0 flex-1 truncate px-1 text-sm font-semibold tracking-[-0.03em] text-ink">
          WhatsApp
        </h1>
      </ViewShell.TopBar>
      <ViewShell.Content class="overflow-y-auto pb-4 mobile:pt-(--mobile-content-inset-top) mobile:pb-(--mobile-content-inset-bottom)">
        {/* The top bar is desktop chrome; touch layouts title the page here. */}
        <h1 class="hidden px-4 pt-2 text-lg font-semibold text-ink touch:block">
          WhatsApp
        </h1>
        {/* Touch has no sidebar: the chats in Macro lead the page. */}
        <Show when={isTouchDevice()}>
          <section aria-labelledby="external-chats" class="px-2">
            <h2
              id="external-chats"
              class="px-2 pt-4 pb-1 text-xs font-semibold tracking-tight text-ink-extra-muted"
            >
              In Macro
            </h2>
            <For each={PROVIDERS}>{(provider) => inMacroChats(provider)}</For>
          </section>
        </Show>
        <WhatsAppLinked resumePairingId={handedOffPairing} />
      </ViewShell.Content>
    </>
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
                  <For each={PROVIDERS}>
                    {(provider) => {
                      const open = () => !folded().includes(provider);
                      return (
                        <>
                          <ViewSidebar.TreeItem
                            active={!params.chatId}
                            label={providerIdentity(provider).label}
                            expanded={open()}
                            onToggle={() => toggleFolded(provider)}
                            onClick={openWhatsApp}
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
            <SplitRouter.Outlet fallback={whatsappPage} />
          </ViewShell.Main>
        </ViewShell.Root>
      </SplitPanel.Body>
    </SplitPanel.Root>
  );
}
