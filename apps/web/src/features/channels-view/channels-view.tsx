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
import { isChannelEntity, ListEntityMetadataQueryProvider } from '@entity';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { createElementSize } from '@solid-primitives/resize-observer';
import { createMemo, createSignal, onMount, Show, Suspense } from 'solid-js';
import { ChannelsViewProvider, useChannelsView } from './channels-view-context';
import { ChannelsRail } from './components/ChannelsRail';
import type { ChannelsViewStateOptions } from './types';

const SIDEBAR_CHANNEL_LIMIT = 100;
const NARROW_RAIL_WIDTH = 64;
const DEFAULT_RAIL_WIDTH = 360;
const MIN_RAIL_WIDTH = 224;
const MAX_RAIL_WIDTH = 420;

export type ChannelsViewProps = {
  /** Explicit navigation state. When present, it wins over entry restoration. */
  initialState?: ChannelsViewStateOptions;
};

function ChannelsViewRoot() {
  const panel = useSplitPanelOrThrow();
  const orchestrator = useGlobalBlockOrchestrator();
  const { state } = useChannelsView();
  const [workspace, setWorkspace] = createSignal<HTMLDivElement>();
  const workspaceSize = createElementSize(workspace);
  const breakpoints = createSizeBreakpoints(
    () => workspaceSize.width ?? undefined,
    { narrow: 720 }
  );
  const railMode = () => (breakpoints.narrow() ? 'slim' : 'full');
  const railLayout = () =>
    railMode() === 'slim'
      ? {
          width: NARROW_RAIL_WIDTH,
          min: NARROW_RAIL_WIDTH,
          max: NARROW_RAIL_WIDTH,
        }
      : {
          width: DEFAULT_RAIL_WIDTH,
          min: MIN_RAIL_WIDTH,
          max: MAX_RAIL_WIDTH,
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
            <div ref={setWorkspace} class="size-full min-h-0 bg-panel">
              <ViewShell.Root
                aside={railLayout()}
                breakpoints={{ collapsed: 0 }}
                layoutBreakpoint="collapsed"
                main={{ min: 224 }}
                resizable={railMode() === 'full'}
              >
                <ViewShell.Aside>
                  <ChannelsRail channels={channels()} mode={railMode()} />
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
                            Choose a channel or person from the sidebar to open
                            the conversation here.
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
                        />
                      </Suspense>
                    )}
                  </Show>
                </ViewShell.Main>
              </ViewShell.Root>
            </div>
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
