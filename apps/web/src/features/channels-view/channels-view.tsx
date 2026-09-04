import { ViewShell } from '@app/components/view-shell';
import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { createSizeBreakpoints } from '@app/util/create-size-breakpoints';
import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import { PreviewPanel } from '@components/app/PreviewPanel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { isChannelEntity, ListEntityMetadataQueryProvider } from '@entity';
import SpinnerIcon from '@phosphor/spinner.svg';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { createElementSize } from '@solid-primitives/resize-observer';
import { createMemo, createSignal, onMount, Show, Suspense } from 'solid-js';
import { ChannelsViewProvider, useChannelsView } from './channels-view-context';
import { ChannelsMobileView } from './components/ChannelsMobileView';
import { ChannelsRail } from './components/rail/ChannelsRail';
import {
  CHANNELS_MAX_RAIL_WIDTH,
  CHANNELS_MIN_RAIL_WIDTH,
  CHANNELS_NARROW_RAIL_WIDTH,
} from './constants';
import type { ChannelsViewStateOptions } from './types';

const SIDEBAR_CHANNEL_LIMIT = 100;

export type ChannelsViewProps = {
  /** Explicit navigation state. When present, it wins over entry restoration. */
  initialState?: ChannelsViewStateOptions;
};

function ChannelsViewRoot() {
  const panel = useSplitPanelOrThrow();
  const orchestrator = useGlobalBlockOrchestrator();
  const { state, setAsideWidth, setRailMode } = useChannelsView();
  const [workspace, setWorkspace] = createSignal<HTMLDivElement>();
  const workspaceSize = createElementSize(workspace);
  const breakpoints = createSizeBreakpoints(
    () => workspaceSize.width ?? undefined,
    { narrow: 720 }
  );
  const railMode = () =>
    state.railMode === 'auto'
      ? breakpoints.narrow()
        ? 'slim'
        : 'full'
      : state.railMode;
  const railLayout = () =>
    railMode() === 'slim'
      ? {
          width: CHANNELS_NARROW_RAIL_WIDTH,
          min: CHANNELS_NARROW_RAIL_WIDTH,
          max: CHANNELS_NARROW_RAIL_WIDTH,
        }
      : {
          width: state.asideWidth,
          min: CHANNELS_MIN_RAIL_WIDTH,
          max: CHANNELS_MAX_RAIL_WIDTH,
        };

  const channelsQuery = useSoupAstItemsQuery(
    () => ({
      params: {
        limit: SIDEBAR_CHANNEL_LIMIT,
        sort_method: 'updated_at',
      },
      body: compileToAst(
        queryStateFrom(
          defineQueryFilters({
            include: {
              channelImportance: true,
              channelIsParticipant: [true],
            },
          })
        )
      ),
    }),
    () => ({ staleTime: 30_000 })
  );
  const channels = createMemo(() =>
    (channelsQuery.data?.entities ?? []).filter(isChannelEntity)
  );
  const selectedChannel = createMemo(() =>
    channels().find((channel) => channel.id === state.selectedChannelId)
  );

  onMount(() => panel.handle.setDisplayName('Channels'));

  return (
    <ListEntityMetadataQueryProvider>
      <StaticMarkdownContext>
        <SplitPanel.Root>
          <SplitPanel.Body>
            <Show
              when={isTouchDevice()}
              fallback={
                <div ref={setWorkspace} class="size-full min-h-0 bg-panel">
                  <ViewShell.Root
                    aside={railLayout()}
                    breakpoints={{ collapsed: 0 }}
                    layoutBreakpoint="collapsed"
                    main={{ min: 224 }}
                    resizable={railMode() === 'full'}
                  >
                    <ViewShell.Aside
                      onWidthChangeEnd={(width) => {
                        if (railMode() === 'full') setAsideWidth(width);
                      }}
                    >
                      <ChannelsRail
                        channels={channels()}
                        mode={railMode()}
                        onModeChange={setRailMode}
                      />
                    </ViewShell.Aside>
                    <ViewShell.Main class="overflow-hidden">
                      <Show
                        when={selectedChannel()}
                        fallback={
                          <div class="flex size-full items-center justify-center px-6 text-center">
                            <div class="flex max-w-sm flex-col gap-2">
                              <h2 class="text-base font-semibold text-ink">
                                Select a conversation
                              </h2>
                              <p class="text-sm leading-5 text-ink-muted">
                                Choose a channel or person from the sidebar to
                                open the conversation here.
                              </p>
                            </div>
                          </div>
                        }
                      >
                        {(channel) => (
                          <Suspense>
                            <PreviewPanel
                              selectedEntity={channel()}
                              orchestrator={orchestrator}
                              splitPanelContext={panel}
                              headerLeading={
                                <Show when={railMode() === 'slim'}>
                                  <SplitPanel.ControlGroup class="mr-1">
                                    <SplitPanel.BackButton />
                                    <SplitPanel.ForwardButton />
                                  </SplitPanel.ControlGroup>
                                </Show>
                              }
                            />
                          </Suspense>
                        )}
                      </Show>
                    </ViewShell.Main>
                  </ViewShell.Root>
                </div>
              }
            >
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
                <ChannelsMobileView channels={channels()} />
              </Suspense>
            </Show>
          </SplitPanel.Body>
        </SplitPanel.Root>
      </StaticMarkdownContext>
    </ListEntityMetadataQueryProvider>
  );
}

/** Channels workspace matching the V2 Chat rail experiment. */
export function ChannelsView(props: ChannelsViewProps) {
  return (
    <ChannelsViewProvider initialState={props.initialState}>
      <ChannelsViewRoot />
    </ChannelsViewProvider>
  );
}
