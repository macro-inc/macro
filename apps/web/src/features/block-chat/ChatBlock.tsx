import { useBlockEntityCommands } from '@app/features/next-soup/actions';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { claimOf, useOptionalSplitRouter } from '@app/lib/split-router';
import { PaneContext } from '@app/lib/split-router/solid/context';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { SidePanel } from '@components/app/side-panel';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { useIsAuthenticated } from '@core/auth';
import {
  EntityLoadGate,
  toEntityLoadError,
} from '@core/component/EntityLoadGate';
import {
  createParamsState,
  ParamsProvider,
} from '@core/component/ParamsProvider';
import { getPermissions } from '@core/component/SharePermissions';
import { useShareModal } from '@core/component/TopBar/shareModal';
import { useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { track } from '@core/internal/trackBlockOpened';
import { DebouncedNotificationReadMarker } from '@notifications';
import { useQueryClient } from '@queries/client';
import { useItemRawName } from '@queries/preview';
import type { GetChatResponse } from '@service-cognition/generated/schemas/getChatResponse';
import { useEntitySubscription } from '@service-connection/client';
import {
  createEffect,
  createResource,
  createSignal,
  on,
  onMount,
  Show,
  useContext,
} from 'solid-js';
import {
  chatDetailSearch,
  chatDetailSearchCodec,
  chatLocationParams,
} from './chat-route';
import {
  canEditChat,
  loadChatSession,
  usesLocalChatScope,
} from './chat-session';
import { Chat } from './component/Chat';
import { ChatSidePanelSections } from './component/sidepanel/ChatSidePanelSections';
import { DEFAULT_CHAT_NAME } from './core/types';

export type ChatBlockProps = {
  chatId: string;
  params?: Record<string, string>;
  navigationRequest?: number | string;
  nested?: boolean;
  routeOwned?: boolean;
};

export function ChatBlock(props: ChatBlockProps) {
  return (
    <Show when={props.chatId} keyed>
      {(chatId) => <ChatLoad {...props} chatId={chatId} />}
    </Show>
  );
}

function ChatLoad(props: ChatBlockProps) {
  const [result, { refetch }] = createResource(
    () => props.chatId,
    loadChatSession
  );
  const data = () =>
    result.state === 'ready' || result.state === 'refreshing'
      ? result.latest
      : undefined;
  return (
    <EntityLoadGate
      result={{
        data,
        error: () => toEntityLoadError(result.error),
        isPending: () =>
          result.state === 'pending' || result.state === 'unresolved',
      }}
      onRetry={() => void refetch()}
      loadErrorTitle="Unable to load this chat"
    >
      <Show when={data()} keyed>
        {(chat) => <LoadedChat {...props} data={chat} />}
      </Show>
    </EntityLoadGate>
  );
}

function LoadedChat(props: ChatBlockProps & { data: GetChatResponse }) {
  const panel = useSplitPanel();
  const localScope = usesLocalChatScope(props.nested, Boolean(panel));
  const [attachScope, scopeId] = localScope
    ? useHotkeyDOMScope('chat')
    : ([undefined, panel!.splitHotkeyScope] as const);
  const params = createParamsState();
  const router = useOptionalSplitRouter();
  const pane = useContext(PaneContext);
  const routeLocation = () => {
    if (!props.routeOwned || !router || !pane) return;
    const entry = pane.entry();
    if (
      !entry ||
      claimOf(router.routes, entry.location.route) !==
        `block:chat:${props.chatId}`
    )
      return;
    const raw = entry.location.search?.[chatDetailSearch.namespace];
    if (!raw) return;
    const parsed = chatDetailSearchCodec.parse(raw);
    if (!parsed.valid || parsed.value.chatId !== props.chatId) return;
    return parsed.value;
  };
  const routeParams = () =>
    chatLocationParams({
      message_id: routeLocation()?.messageId,
      share: routeLocation()?.share,
    });
  const [pendingLocation, setPendingLocation] = createSignal<
    Record<string, string> | undefined
  >(undefined, { equals: false });
  createEffect(
    on(
      () =>
        props.routeOwned
          ? ([
              routeLocation()?.messageId,
              routeLocation()?.share,
              routeLocation()?.seek,
              props.chatId,
            ] as const)
          : ([props.params, props.navigationRequest] as const),
      () => {
        const location = props.routeOwned
          ? routeParams()
          : chatLocationParams(props.params);
        params.navigate(location);
        setPendingLocation(location);
      }
    )
  );
  const permissions = () => getPermissions(props.data.userAccessLevel);
  const authenticated = useIsAuthenticated();
  const canEdit = () =>
    canEditChat(props.data.userAccessLevel, Boolean(authenticated()));
  const updatedName = useItemRawName(() => ({
    type: 'chat',
    id: props.chatId,
  }));
  const name = () => updatedName() || props.data.chat.name || DEFAULT_CHAT_NAME;
  const openShare = useShareModal(() => ({
    id: props.chatId,
    blockAlias: 'chat',
    itemType: 'chat',
    name: name(),
    userPermissions: permissions(),
    owner: props.data.chat.userId,
  }));
  createEffect(
    on(
      () =>
        props.routeOwned
          ? ([routeLocation()?.share, routeLocation()?.seek] as const)
          : ([props.params?.share, props.navigationRequest] as const),
      ([share]) => {
        if (share === 'true') openShare();
      }
    )
  );
  useBlockEntityCommands({
    id: props.chatId,
    scopeId,
    resolveEntity: () => ({
      type: 'chat',
      id: props.chatId,
      name: name(),
      ownerId: props.data.chat.userId,
    }),
  });
  useEntitySubscription(() => ({
    entity_type: 'chat',
    entity_id: props.chatId,
  }));
  const notificationSource = useGlobalNotificationSource();
  const analytics = useAnalytics();
  const client = useQueryClient();
  onMount(() => {
    if (props.nested) return;
    track({ itemId: props.chatId, blockName: 'chat', client: () => client });
    analytics.pageView('chat');
    analytics.track('open_entity', {
      entityType: 'chat',
      entityId: props.chatId,
    });
  });

  return (
    <ParamsProvider
      state={params}
      urlParams={
        props.routeOwned ? routeParams() : chatLocationParams(props.params)
      }
    >
      <div
        class="portal-scope relative size-full"
        tabIndex={-1}
        ref={(element) => {
          attachScope?.(element);
        }}
      >
        <DebouncedNotificationReadMarker
          notificationSource={notificationSource}
          entity={{ type: 'chat', id: props.chatId }}
        />
        <SidePanel.Layout defaultOpen={false} floating>
          <ChatSidePanelSections
            chatId={props.chatId}
            data={props.data.chat}
            canEdit={canEdit()}
          />
          <Chat
            data={props.data}
            chatId={props.chatId}
            scopeId={scopeId}
            canEdit={canEdit}
            nested={props.nested}
            showHeader={Boolean(panel)}
            name={name}
            permissions={permissions}
            pendingLocation={pendingLocation}
            setPendingLocation={setPendingLocation}
            navigate={params.navigate}
          />
        </SidePanel.Layout>
      </div>
    </ParamsProvider>
  );
}
