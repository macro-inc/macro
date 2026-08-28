import {
  useViewTabHotkeys,
  useViewShell,
  ViewShell,
} from '@app/components/view-shell';
import { buildFlatSoupRows } from '@app/features/soup';
import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import { PreviewPanel } from '@components/app/PreviewPanel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import {
  type EntityData,
  ListEntityMetadataQueryProvider,
  type WithNotification,
} from '@entity';
import SpinnerIcon from '@phosphor/spinner.svg';
import { createEffect, onMount, Show, Suspense } from 'solid-js';
import { openEntityInSplitFromUnifiedList } from '../next-soup/utils';
import { InboxHeader } from './components/InboxHeader';
import { InboxList } from './components/InboxList';
import { InboxTabs } from './components/InboxTabs';
import {
  type CreateInboxViewStateOptions,
  createInboxViewState,
  type InboxViewState,
} from './create-inbox-view-state';
import { type InboxQuery, useInboxQuery } from './queries/use-inbox-query';
import type { InboxTab } from './types';

const INBOX_TAB_IDS: readonly InboxTab[] = ['signal', 'noise', 'all'];

export type InboxViewProps = {
  /** Externally owned state; bypasses the view's built-in persistence. */
  state?: InboxViewState;
  /** Explicit navigation state. When present, it wins over entry restoration. */
  initialState?: CreateInboxViewStateOptions;
};

type InboxWorkspaceProps = {
  state: InboxViewState;
  source: InboxQuery;
};

function InboxFallback() {
  return (
    <div class="grid min-h-0 min-w-0 flex-1 place-items-center text-ink-muted">
      <SpinnerIcon aria-label="Loading inbox" class="size-5 animate-spin" />
    </div>
  );
}

function InboxWorkspace(props: InboxWorkspaceProps) {
  const panel = useSplitPanelOrThrow();
  const shell = useViewShell();
  const orchestrator = useGlobalBlockOrchestrator();

  useViewTabHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    ids: () => INBOX_TAB_IDS,
    activeId: props.state.tab,
    setActiveId: props.state.setTab,
  });

  function focusedEntity() {
    const focusKey = props.state.listFocusKey();
    if (!focusKey) return undefined;

    return buildFlatSoupRows([...props.source.entities()]).find(
      (row) => row.id === focusKey
    )?.entity;
  }

  function open(
    entity: WithNotification<EntityData>,
    options: { newSplit: boolean; replacePair: boolean }
  ) {
    if (!options.newSplit && shell.detail.placement() === 'inline') return;

    void openEntityInSplitFromUnifiedList(entity, {
      openInNewSplit: options.newSplit,
      splitHandle: panel.handle,
      referredFrom: 'inbox',
    });
  }

  return (
    <>
      <ViewShell.Main class="bg-ink/2">
        <InboxHeader />
        <InboxTabs state={props.state} />
        <Suspense fallback={<InboxFallback />}>
          <InboxList state={props.state} source={props.source} onOpen={open} />
        </Suspense>
      </ViewShell.Main>
      <ViewShell.Detail class="overflow-hidden bg-surface">
        <Show
          when={focusedEntity()}
          fallback={
            <div class="flex size-full items-center justify-center px-6 text-center text-ink-extra-muted text-sm">
              Select an inbox item to preview it.
            </div>
          }
        >
          {(entity) => (
            <PreviewPanel
              selectedEntity={entity()}
              orchestrator={orchestrator}
              splitPanelContext={panel}
            />
          )}
        </Show>
      </ViewShell.Detail>
    </>
  );
}

/** Composable heterogeneous Inbox built on the shared view and Soup primitives. */
export function InboxView(props: InboxViewProps) {
  const panel = useSplitPanelOrThrow();
  const state =
    props.state ??
    createInboxViewState(props.initialState, {
      handle: panel.handle,
    });
  const source = useInboxQuery(state);

  createEffect(() => {
    if (state.tab() !== 'reminders') return;

    state.setTab('signal');
  });

  onMount(() => panel.handle.setDisplayName('Inbox'));

  return (
    <ListEntityMetadataQueryProvider>
      <StaticMarkdownContext>
        <SplitPanel.Root>
          <SplitPanel.Body>
            <ViewShell.Root
              resizable
              aside={false}
              main={{ width: 320, min: 224, max: 360 }}
              detail={{
                width: 720,
                initialWidth: 'auto',
                min: 320,
                max: 1600,
                whenNarrow: 'hide',
              }}
              detailOpen
            >
              <InboxWorkspace state={state} source={source} />
            </ViewShell.Root>
          </SplitPanel.Body>
        </SplitPanel.Root>
      </StaticMarkdownContext>
    </ListEntityMetadataQueryProvider>
  );
}
