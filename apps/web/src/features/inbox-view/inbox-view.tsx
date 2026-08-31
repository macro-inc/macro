import {
  createListController,
  type ListActivation,
} from '@app/components/list';
import {
  useViewShell,
  useViewTabHotkeys,
  ViewShell,
} from '@app/components/view-shell';
import {
  useGlobalBlockOrchestrator,
  useGlobalNotificationSource,
} from '@components/app/GlobalAppState';
import { PreviewPanel } from '@components/app/PreviewPanel';
import type {
  SplitListActivationMetadata,
  SplitListRow,
} from '@components/app/split-layout/context';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import {
  type EntityData,
  isNonMemberChannelEntity,
  ListEntityMetadataQueryProvider,
  type WithNotification,
} from '@entity';
import SpinnerIcon from '@phosphor/spinner.svg';
import { createEffect, onMount, Show, Suspense } from 'solid-js';
import { persistSoupNavigationTouchHighlight } from '../next-soup/soup-view/soup-navigation-touch-highlight';
import {
  markChannelTargetSeenOnOpen,
  markReminderSeenOnOpen,
  openEntityInSplitFromUnifiedList,
} from '../next-soup/utils';
import { InboxHeader } from './components/InboxHeader';
import { InboxList } from './components/InboxList';
import { InboxTabs } from './components/InboxTabs';
import {
  type CreateInboxViewStateOptions,
  createInboxViewState,
  type InboxViewState,
} from './create-inbox-view-state';
import { useInboxDataSource } from './queries/use-inbox-query';
import type { InboxTab } from './types';

const INBOX_TAB_IDS: readonly InboxTab[] = ['signal', 'noise', 'all'];

export type InboxViewProps = {
  /** Explicit navigation state. When present, it wins over entry restoration. */
  initialState?: CreateInboxViewStateOptions;
};

type InboxWorkspaceProps = {
  state: InboxViewState;
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
  const notificationSource = useGlobalNotificationSource();

  const list = panel.setList(() => {
    const dataSource = useInboxDataSource(props.state);
    const controller = createListController<
      SplitListRow,
      SplitListActivationMetadata
    >({
      items: dataSource.items,
      getKey: (row) => row.id,
      selection: {
        getKey: (row) => (row.kind === 'entity' ? row.entity.id : row.id),
      },
      isNavigable: (row) => row.kind === 'entity' || row.kind === 'load-more',
      isSelectable: (row) => row.kind === 'entity',
      onActivate: ({
        item,
        metadata,
      }: ListActivation<SplitListRow, SplitListActivationMetadata>) => {
        if (item.kind === 'load-more') {
          if (!item.isLoading) void dataSource.loadMore();
          return;
        }

        if (item.kind !== 'entity') return;

        const sourceRow = dataSource.items().find((row) => row.id === item.id);
        if (sourceRow?.kind !== 'entity') return;

        const newSplit =
          metadata?.newSplit === true || metadata?.event?.shiftKey === true;
        void open(sourceRow.entity, {
          event: metadata?.event,
          newSplit,
          replacePair: false,
        });
      },
    });

    return {
      viewId: 'inbox',
      dataSource,
      controller,
    };
  });

  useViewTabHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    ids: () => INBOX_TAB_IDS,
    activeId: props.state.tab,
    setActiveId: props.state.setTab,
  });

  function focusedEntity() {
    const focusKey = list.controller.focus.key();
    if (!focusKey) return undefined;

    const row = list.dataSource.items().find((item) => item.id === focusKey);
    if (row?.kind !== 'entity') return undefined;

    return row.entity;
  }

  async function open(
    entity: WithNotification<EntityData>,
    options: {
      event?: MouseEvent;
      newSplit: boolean;
      replacePair: boolean;
    }
  ) {
    markReminderSeenOnOpen(entity, notificationSource);
    if (!isNonMemberChannelEntity(entity)) {
      markChannelTargetSeenOnOpen(entity, notificationSource);
    }

    if (!options.newSplit && shell.detail.placement() === 'inline') return;

    const finishTouchHighlight = options.event
      ? persistSoupNavigationTouchHighlight(options.event)
      : undefined;

    try {
      await openEntityInSplitFromUnifiedList(entity, {
        openInNewSplit: options.newSplit,
        replacePreview: options.replacePair,
        splitHandle: panel.handle,
        referredFrom: 'inbox',
      });
    } finally {
      finishTouchHighlight?.();
    }
  }

  return (
    <>
      <ViewShell.Main>
        <InboxHeader />
        <InboxTabs state={props.state} />
        <Suspense fallback={<InboxFallback />}>
          <InboxList
            state={props.state}
            source={list.dataSource}
            list={list.controller}
          />
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
  const state = createInboxViewState(props.initialState, {
    handle: panel.handle,
  });

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
              <InboxWorkspace state={state} />
            </ViewShell.Root>
          </SplitPanel.Body>
        </SplitPanel.Root>
      </StaticMarkdownContext>
    </ListEntityMetadataQueryProvider>
  );
}
