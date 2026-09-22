import { ViewShell } from '@app/components/view-shell';
import { markChannelNotificationsSeenOnOpen } from '@app/features/next-soup/utils';
import { MaybeSoupEntityActionDrawerManager } from '@app/features/soup';
import { withEntityNotifications } from '@app/features/soup/entity-notifications';
import {
  useGlobalBlockOrchestrator,
  useGlobalNotificationSource,
} from '@components/app/GlobalAppState';
import { PreviewPanel } from '@components/app/PreviewPanel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { ListEntityMetadataQueryProvider } from '@entity';
import SpinnerIcon from '@phosphor/spinner.svg';
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onMount,
  Show,
  Suspense,
} from 'solid-js';
import { ChannelsViewProvider, useChannelsView } from './channels-view-context';
import { ChannelsMobileView } from './components/ChannelsMobileView';
import { ChannelsRail } from './components/rail/ChannelsRail';
import {
  deduplicateChannels,
  resolveSelectedChannel,
  useChannelByIdQuery,
  useChannelsSources,
} from './queries';
import type { ChannelsViewStateOptions } from './types';

export type ChannelsViewProps = {
  /** Explicit navigation state. When present, it wins over entry restoration. */
  initialState?: ChannelsViewStateOptions;
};

function ChannelsViewRoot() {
  const panel = useSplitPanelOrThrow();
  const orchestrator = useGlobalBlockOrchestrator();
  const notificationSource = useGlobalNotificationSource();
  const { state, mobileLayout, previewChannelId, setAsideWidth, setMobileTab } =
    useChannelsView();
  const [railSearchOpen, setRailSearchOpen] = createSignal(false);

  const sources = useChannelsSources(
    (scope) => {
      if (mobileLayout())
        return scope !== 'search' && state.mobileTab === scope;
      if (railSearchOpen()) return scope === 'search';
      if (scope === 'search') return false;
      if (scope === 'recents') return state.tab === 'recents';
      return state.tab === 'browse';
    },
    (group) => state.sortBy[group]
  );
  const loadedChannels = createMemo(() =>
    deduplicateChannels([
      sources.channels.items(),
      sources.direct_messages.items(),
      sources.recents.items(),
      sources.search.items(),
    ])
  );
  const loadedSelectedChannel = createMemo(() =>
    resolveSelectedChannel(previewChannelId(), loadedChannels())
  );
  // Only a new selection may request a full edge. Incoming unread updates must
  // not blank/remount an already-open conversation or steal composer focus.
  const selectionNeedsFullEdge = createMemo(
    on(previewChannelId, () => {
      const loaded = loadedSelectedChannel();
      return (
        loaded === undefined || (loaded.unreadNotifications?.length ?? 0) > 0
      );
    })
  );
  const selectedChannelQuery = useChannelByIdQuery(
    previewChannelId,
    () =>
      !mobileLayout() &&
      previewChannelId() !== undefined &&
      (selectionNeedsFullEdge() || loadedSelectedChannel() === undefined)
  );
  const selectedChannel = createMemo(
    (previous: ReturnType<typeof loadedSelectedChannel> | undefined) => {
      const loaded = loadedSelectedChannel();
      if (loaded && !selectionNeedsFullEdge()) {
        return loaded.unreadNotifications === undefined
          ? loaded
          : { ...loaded, notifications: () => [] };
      }
      if (
        !selectedChannelQuery.isEnabled ||
        selectedChannelQuery.isLoading ||
        selectedChannelQuery.isFetching ||
        selectedChannelQuery.error
      ) {
        return previous?.id === previewChannelId() ? previous : undefined;
      }

      const full = resolveSelectedChannel(
        previewChannelId(),
        [],
        selectedChannelQuery.data?.entities
      );
      return full
        ? withEntityNotifications(full, notificationSource)
        : undefined;
    }
  );

  const selectionUnavailable = () =>
    previewChannelId() !== undefined &&
    (Boolean(selectedChannelQuery.error) ||
      (selectedChannelQuery.isEnabled &&
        !selectedChannelQuery.isLoading &&
        !selectedChannelQuery.isFetching &&
        selectedChannel() === undefined));

  // Stabilize the identity: metadata updates must not repeat the selection action.
  const readySelectionId = createMemo(() => selectedChannel()?.id);

  // The bounded unread witness is never passed to a bulk mark-read operation.
  // Send the complete, thread-scoped selection once the chosen preview is ready.
  createEffect(
    on(readySelectionId, () => {
      const channel = selectedChannel();
      if (channel && channel.isParticipant !== false)
        markChannelNotificationsSeenOnOpen(channel, notificationSource);
    })
  );

  const retrySelection = async () => {
    try {
      await selectedChannelQuery.refresh();
    } catch {
      // The query's inline error remains visible so another retry is possible.
    }
  };

  onMount(() => panel.handle.setDisplayName('Channels'));

  return (
    <ListEntityMetadataQueryProvider>
      <StaticMarkdownContext>
        <SplitPanel.Root>
          <SplitPanel.Body>
            <Show
              when={mobileLayout()}
              fallback={
                <div class="size-full min-h-0 bg-panel">
                  <ViewShell.Root
                    asidePreferenceKey="channels"
                    aside={{
                      width: state.asideWidth,
                      preserveDuringResize: false,
                    }}
                    main={{ preferredWidth: 640 }}
                    resizable
                  >
                    <ViewShell.Aside onWidthChangeEnd={setAsideWidth}>
                      <ChannelsRail
                        sources={sources}
                        searchOpen={railSearchOpen()}
                        onSearchOpenChange={setRailSearchOpen}
                      />
                    </ViewShell.Aside>
                    <ViewShell.Main class="overflow-hidden">
                      <Show
                        when={selectedChannel()}
                        fallback={
                          <>
                            <ViewShell.TopBar>
                              <span class="text-sm font-semibold">Chat</span>
                            </ViewShell.TopBar>
                            <div class="flex min-h-0 flex-1 items-center justify-center px-6 text-center">
                              <div class="flex max-w-sm flex-col gap-2">
                                <h2 class="text-base font-semibold text-ink">
                                  {selectionUnavailable()
                                    ? 'Conversation unavailable'
                                    : previewChannelId()
                                      ? 'Loading conversation'
                                      : 'Select a conversation'}
                                </h2>
                                <p class="text-sm leading-5 text-ink-muted">
                                  {selectionUnavailable()
                                    ? 'Could not load this conversation.'
                                    : previewChannelId()
                                      ? 'Preparing the conversation…'
                                      : 'Choose a channel or person from the sidebar to open the conversation here.'}
                                </p>
                                <Show when={selectionUnavailable()}>
                                  <button
                                    type="button"
                                    onClick={retrySelection}
                                  >
                                    Retry
                                  </button>
                                </Show>
                              </div>
                            </div>
                          </>
                        }
                      >
                        {(channel) => (
                          <Suspense>
                            <PreviewPanel
                              selectedEntity={channel()}
                              orchestrator={orchestrator}
                              splitPanelContext={panel}
                            />
                          </Suspense>
                        )}
                      </Show>
                    </ViewShell.Main>
                  </ViewShell.Root>
                </div>
              }
            >
              <MaybeSoupEntityActionDrawerManager>
                <Suspense
                  fallback={
                    <div class="grid size-full place-items-center text-ink-muted">
                      <SpinnerIcon
                        aria-label="Loading channels"
                        class="size-5 animate-spin"
                      />
                    </div>
                  }
                >
                  <ChannelsMobileView
                    source={sources[state.mobileTab]}
                    tab={state.mobileTab}
                    onTabChange={setMobileTab}
                  />
                </Suspense>
              </MaybeSoupEntityActionDrawerManager>
            </Show>
          </SplitPanel.Body>
        </SplitPanel.Root>
      </StaticMarkdownContext>
    </ListEntityMetadataQueryProvider>
  );
}

/** Chat workspace with shared workspace navigation. */
export function ChannelsView(props: ChannelsViewProps) {
  return (
    <ChannelsViewProvider initialState={props.initialState}>
      <ChannelsViewRoot />
    </ChannelsViewProvider>
  );
}
