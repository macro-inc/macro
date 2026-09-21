import { openChatWithInput } from '@app/features/chat/ChatWithAgentButton';
import { toQuerySchema } from '@app/features/database-query/queries/query-source';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { makePersistedState } from '@app/lib/persistence';
import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import { useSplitLayout } from '@components/app/split-layout/layout';
import {
  returnSplitToRecentListView,
  useCanAutofocusSplitContent,
  useSplitPanelOrThrow,
} from '@components/app/split-layout/layoutUtils';
import { useNavigatedFromJK } from '@components/app/useNavigatedFromJK';
import { useBlockId } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { toast } from '@core/component/Toast/Toast';
import { enableDatabases } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { createMethodRegistration } from '@core/orchestrator';
import { blockHandleSignal } from '@core/signal/load';
import { deepEqual } from '@core/util/compareUtils';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import DatabaseIcon from '@phosphor/database.svg';
import LockIcon from '@phosphor/lock-simple.svg';
import SparkleIcon from '@phosphor/sparkle.svg';
import { useDatabaseDetailQuery } from '@queries/storage/databases';
import { useDatabaseTableChangedSync } from '@queries/storage/databases-sync';
import { getEntityGraphqlClient } from '@service-storage/graphql-soup';
import { Button } from '@ui';
import {
  type Component,
  createMemo,
  createSignal,
  ErrorBoundary,
  For,
  Show,
  untrack,
} from 'solid-js';
import { DatabaseTitle } from '../components/database-title';
import { DatabaseToolbar } from '../components/database-toolbar';
import { databaseChatContext } from '../core/chat-context';
import type { DatabaseRelatedDestination } from '../core/database-relations';
import {
  type DatabaseViewConfig,
  defaultDatabaseView,
  reconcileDatabaseView,
} from '../core/database-view';
import {
  clearSavedViewDraft,
  type DatabaseViewSelection,
  readViewSelection,
  type TableViewState,
} from '../core/view-selection';
import { renameDatabase } from '../queries/rename-database';
import {
  type DatabaseBoardOrderPatch,
  useSavedDatabaseViews,
} from '../queries/saved-database-views';
import { toViewColumn } from '../queries/table-rows';
import { trashDatabase } from '../queries/trash-database';
import { DatabasePageActions } from '../views/database-page-actions';
import { AddColumnMenu } from './AddColumnMenu';
import { DatabaseGrid } from './DatabaseGrid';
import { TableTabs } from './TableTabs';

const Block: Component = () => {
  const databaseId = useBlockId();
  const panel = useSplitPanelOrThrow();
  let editTitle: (() => void) | undefined;
  const { replaceOrInsertSplit } = useSplitLayout();
  const orchestrator = useGlobalBlockOrchestrator();
  let requestedRecord: DatabaseRelatedDestination | undefined;
  const canAutofocus = useCanAutofocusSplitContent();
  const { navigatedFromJK } = useNavigatedFromJK();
  const userId = untrack(useUserId());
  const storage = createUserScopedStorage(
    `database-view-selection:${databaseId}`
  );
  const [selection, setSelection] = makePersistedState(
    createSignal<DatabaseViewSelection>({ views: {}, drafts: {} }),
    {
      storages: {
        restore: () => {
          if (!userId) return;
          return readViewSelection(storage.read(userId));
        },
        write: (value) => {
          if (userId) storage.write(userId, JSON.stringify(value));
        },
      },
    }
  );
  useDatabaseTableChangedSync(() => databaseId);
  const detailQuery = useDatabaseDetailQuery(() => databaseId);
  let gridEntry:
    | {
        tableId: string;
        focus: () => Promise<void>;
        openRecord: (rowId: string) => void;
      }
    | undefined;
  function openRequestedRecord() {
    const target = requestedRecord;
    if (!target || !gridEntry || gridEntry.tableId !== target.tableId) return;
    requestedRecord = undefined;
    gridEntry.openRecord(target.rowId);
  }
  async function openRelated(target: DatabaseRelatedDestination) {
    if (target.databaseId !== databaseId) {
      replaceOrInsertSplit({
        type: 'database',
        id: target.databaseId,
      });
      try {
        const handle = await orchestrator.getBlockHandle(
          target.databaseId,
          'database'
        );
        await handle?.goToLocationFromParams({
          tableId: target.tableId,
          rowId: target.rowId,
        });
      } catch {
        toast.failure('This related record could not be opened.');
      }
      return;
    }
    requestedRecord = target;
    setSelection((current) => ({ ...current, tableId: target.tableId }));
    queueMicrotask(openRequestedRecord);
  }
  createMethodRegistration(blockHandleSignal.get, {
    goToLocationFromParams: (params: Record<string, string>) => {
      if (params.tableId && params.viewId) {
        setSelection((current) => {
          const drafts = { ...current.drafts };
          delete drafts[params.tableId];
          return {
            ...current,
            tableId: params.tableId,
            views: { ...current.views, [params.tableId]: params.viewId },
            drafts,
          };
        });
      }
      if (params.tableId && params.rowId)
        void openRelated({
          databaseId,
          tableId: params.tableId,
          rowId: params.rowId,
        });
    },
  });
  let requestedGridEntry = false;
  const enterFirstCell = () => {
    if (!gridEntry || gridEntry.tableId !== activeTableId()) {
      requestedGridEntry = true;
      return;
    }
    requestedGridEntry = false;
    void gridEntry.focus();
  };
  const [openingChat, setOpeningChat] = createSignal(false);
  async function openDatabaseChat() {
    const current = detail();
    if (!current || openingChat()) return;
    setOpeningChat(true);
    try {
      await openChatWithInput(
        databaseChatContext(toQuerySchema(current, activeTableId()))
      );
    } finally {
      setOpeningChat(false);
    }
  }
  const tableViews = () => selection().drafts;
  const emptyView = defaultDatabaseView();

  // Reading data only after status resolves keeps the database shell mounted.
  const detail = () => (!detailQuery.isPending ? detailQuery.data : undefined);
  const tables = () => detail()?.tables ?? [];
  const activeTable = createMemo(
    () =>
      tables().find((table) => table.table.id === selection().tableId) ??
      tables()[0]
  );
  const activeTableId = () => activeTable()?.table.id;
  const canEdit = () =>
    detail()?.grant === 'edit' || detail()?.grant === 'owner';
  const columns = () =>
    activeTable()
      ?.columns.filter((column) => column.column.config?.kind !== 'lookup')
      .map(toViewColumn) ?? [];
  const saved = useSavedDatabaseViews(() => databaseId, activeTableId);
  const viewState = () => {
    const tableId = activeTableId() ?? '';
    const edited = tableViews()[tableId];
    if (edited) return edited;
    const selected = saved
      .views()
      .find((entry) => entry.id === selection().views[tableId]);
    return selected
      ? { view: selected.view, selectedViewId: selected.id }
      : undefined;
  };
  const view = () =>
    reconcileDatabaseView(viewState()?.view ?? emptyView, columns());
  const selectedViewId = () => viewState()?.selectedViewId;
  const selectedView = () =>
    saved.views().find((entry) => entry.id === selectedViewId());
  const isDirty = () =>
    !deepEqual(
      view(),
      reconcileDatabaseView(selectedView()?.view ?? emptyView, columns())
    );

  function setViewState(state: TableViewState, tableId = activeTableId()) {
    if (!tableId) return;
    const original =
      saved.views().find((entry) => entry.id === state.selectedViewId)?.view ??
      emptyView;
    setSelection((current) => {
      const drafts = { ...current.drafts };
      if (deepEqual(state.view, reconcileDatabaseView(original, columns())))
        delete drafts[tableId];
      else drafts[tableId] = state;
      return { ...current, drafts };
    });
    if (selection().views[tableId] !== state.selectedViewId) {
      setSelection((current) => {
        const views = { ...current.views };
        if (state.selectedViewId) views[tableId] = state.selectedViewId;
        else delete views[tableId];
        return { ...current, views };
      });
    }
  }
  function changeView(config: DatabaseViewConfig) {
    const previous = view();
    const laneOrderChanged =
      config.groupOrder !== undefined &&
      !deepEqual(previous.groupOrder, config.groupOrder);
    const cardOrderChanged =
      (config.cardOrder !== undefined || config.groupBy === previous.groupBy) &&
      !deepEqual(previous.cardOrder, config.cardOrder);
    const selected = selectedView();
    const tableId = activeTableId();
    setViewState({ view: config, selectedViewId: selectedViewId() });
    if ((laneOrderChanged || cardOrderChanged) && selected && tableId)
      void persistBoardOrder(tableId, selected.id, selected.name, {
        layout: config.layout,
        groupBy: config.groupBy,
        ...(laneOrderChanged || config.groupBy !== selected.view.groupBy
          ? { groupOrder: config.groupOrder }
          : {}),
        ...(cardOrderChanged
          ? { cardOrder: config.cardOrder, sorts: config.sorts }
          : {}),
      });
  }
  function clearSavedDraft(
    tableId: string,
    id: string,
    config: DatabaseViewConfig
  ) {
    setSelection((current) =>
      clearSavedViewDraft(current, tableId, id, config)
    );
  }
  async function persistBoardOrder(
    tableId: string,
    id: string,
    name: string,
    boardOrder: DatabaseBoardOrderPatch
  ) {
    try {
      const result = await saved.save.mutateAsync({
        tableId,
        id,
        name,
        boardOrder,
        preserveName: true,
      });
      clearSavedDraft(tableId, id, result.view);
    } catch {
      toast.failure(
        'The board order could not be saved. Use Save changes to retry.'
      );
    }
  }
  function selectView(id?: string) {
    const selected = saved.views().find((entry) => entry.id === id);
    setViewState({
      view: selected?.view ?? defaultDatabaseView(),
      selectedViewId: selected?.id,
    });
  }
  async function saveView(
    name: string,
    layout: DatabaseViewConfig['layout'],
    groupBy?: string | null
  ) {
    const tableId = activeTableId();
    const original = view();
    const originalState = tableId ? tableViews()[tableId] : undefined;
    const config = reconcileDatabaseView(
      {
        ...original,
        layout,
        groupBy: groupBy ?? original.groupBy,
        groupOrder:
          groupBy && groupBy !== original.groupBy
            ? undefined
            : original.groupOrder,
        cardOrder:
          groupBy && groupBy !== original.groupBy
            ? undefined
            : original.cardOrder,
      },
      columns()
    );
    const { id } = await saved.save.mutateAsync({
      name,
      view: config,
      tableId,
    });
    const current = tableId ? tableViews()[tableId] : undefined;
    if (
      current !== originalState &&
      current?.selectedViewId !== originalState?.selectedViewId
    )
      return;
    setViewState(
      {
        view: current && current !== originalState ? current.view : config,
        selectedViewId: id,
      },
      tableId
    );
  }
  async function updateView() {
    const selected = selectedView();
    const tableId = activeTableId();
    const config = view();
    if (selected && tableId) {
      await saved.save.mutateAsync({
        tableId,
        id: selected.id,
        name: selected.name,
        view: config,
      });
      clearSavedDraft(tableId, selected.id, config);
    }
  }
  async function removeView(id: string) {
    const tableId = activeTableId();
    const config = view();
    await saved.remove.mutateAsync(id);
    if (tableId && selection().views[tableId] === id) {
      setViewState({ view: tableViews()[tableId]?.view ?? config }, tableId);
    }
  }

  return (
    <DocumentBlockContainer>
      <div
        class="@container/database flex size-full min-h-0 min-w-0 flex-col overflow-hidden bg-canvas-base text-ink"
        style={{ '--database-title-column-width': '18rem' }}
      >
        <header class="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-edge-muted px-4 py-3 @min-[900px]/database:flex-nowrap @min-[900px]/database:px-5">
          {/* Align the table rail with the first grid column's trailing edge,
              accounting for the row gutter, header padding, and header gap. */}
          <div class="flex min-w-0 flex-1 items-center gap-2.5 @min-[900px]/database:w-[calc(var(--database-title-column-width)+2.75rem-2.25rem)] @min-[900px]/database:flex-none">
            <div class="grid size-8 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
              <DatabaseIcon class="size-4" />
            </div>
            <div class="min-w-0 flex-1">
              <Show
                when={detail()}
                fallback={<span class="text-lg font-semibold">Database</span>}
              >
                <DatabaseTitle
                  name={detail()?.database.name ?? 'Database'}
                  canEdit={canEdit()}
                  onConfirm={enterFirstCell}
                  onEditReady={(edit) => (editTitle = edit)}
                  autoFocus={
                    canAutofocus &&
                    !navigatedFromJK() &&
                    detail()?.database.name === 'Untitled database'
                  }
                  onRename={(name) =>
                    renameDatabase(getEntityGraphqlClient(), databaseId, name)
                  }
                />
              </Show>
              <Show when={detail() && !canEdit()}>
                <span class="mt-0.5 inline-flex items-center gap-1 text-[11px] text-ink-muted">
                  <LockIcon class="size-3" /> Read only
                </span>
              </Show>
            </div>
          </div>
          <Show when={detail()}>
            <div class="order-3 w-full min-w-0 @min-[900px]/database:order-none @min-[900px]/database:w-auto @min-[900px]/database:flex-1 @min-[900px]/database:border-l @min-[900px]/database:border-edge-muted @min-[900px]/database:pl-4">
              <TableTabs
                databaseId={databaseId}
                tables={tables()}
                activeTableId={activeTableId()}
                canEdit={canEdit()}
                onSelect={(tableId) =>
                  setSelection((current) => ({ ...current, tableId }))
                }
              />
            </div>
          </Show>
          <div class="ml-auto flex shrink-0 items-center gap-1">
            <Show when={detail()}>
              {(database) => (
                <DatabasePageActions
                  detail={database()}
                  table={activeTable()}
                  onRename={() => editTitle?.()}
                  onDelete={async () => {
                    await trashDatabase(getEntityGraphqlClient(), databaseId);
                    returnSplitToRecentListView(panel.handle);
                  }}
                  onImported={(tableId) =>
                    setSelection((current) => ({ ...current, tableId }))
                  }
                />
              )}
            </Show>
            <Button
              variant="ghost"
              size="sm"
              class="h-8 gap-1.5 px-2 text-xs"
              disabled={!detail() || openingChat()}
              aria-label="Database AI"
              aria-busy={openingChat()}
              onClick={() => void openDatabaseChat()}
            >
              <SparkleIcon class="size-4" />
              <span>AI</span>
            </Button>
          </div>
        </header>
        <ErrorBoundary
          fallback={(error: unknown, reset) => (
            <div
              class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
              role="alert"
            >
              <p class="font-medium">This database could not be displayed</p>
              <p class="max-w-md text-sm text-ink-muted">
                {error instanceof Error
                  ? error.message
                  : 'Please try opening it again.'}
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  reset();
                  void detailQuery.refetch();
                }}
              >
                Try again
              </Button>
            </div>
          )}
        >
          <Show when={!detailQuery.isPending} fallback={<DatabaseSkeleton />}>
            <Show
              when={detail()}
              fallback={
                <div
                  class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
                  role="alert"
                >
                  <p class="font-medium">Could not open this database</p>
                  <p class="max-w-md text-sm text-ink-muted">
                    It may be unavailable, or you may no longer have access.
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => void detailQuery.refetch()}
                  >
                    Try again
                  </Button>
                </div>
              }
            >
              <Show
                when={activeTable()}
                fallback={
                  <div class="grid flex-1 place-items-center p-6 text-sm text-ink-muted">
                    Add a table to start organizing your data.
                  </div>
                }
              >
                <Show when={saved.query.isError}>
                  <div
                    class="flex items-center justify-between gap-2 border-edge border-b px-4 py-2 text-xs text-ink-muted"
                    role="status"
                  >
                    Saved views could not be loaded.
                    <Button
                      size="xs"
                      onClick={() => void saved.query.refetch()}
                    >
                      Retry
                    </Button>
                  </div>
                </Show>
                <div class="flex min-h-0 min-w-0 flex-1 flex-col @min-[1000px]/database:flex-row">
                  <div class="flex min-h-0 min-w-0 flex-1 flex-col">
                    <Show when={activeTable()}>
                      {(table) => (
                        <DatabaseGrid
                          databaseId={databaseId}
                          table={table()}
                          canEdit={canEdit()}
                          view={view()}
                          onViewChange={changeView}
                          onOpenRelated={openRelated}
                          renderToolbar={(actions) => {
                            gridEntry = {
                              tableId: table().table.id,
                              focus: actions.focusFirstCell,
                              openRecord: actions.openRecord,
                            };
                            if (requestedRecord)
                              queueMicrotask(openRequestedRecord);
                            if (requestedGridEntry)
                              queueMicrotask(enterFirstCell);
                            return (
                              <DatabaseToolbar
                                columns={columns()}
                                value={view()}
                                onChange={changeView}
                                savedViews={saved.views()}
                                selectedViewId={selectedViewId()}
                                isDirty={isDirty()}
                                saving={
                                  saved.save.isPending ||
                                  saved.rename.isPending ||
                                  saved.remove.isPending
                                }
                                onSelectView={selectView}
                                onSaveView={saveView}
                                onUpdateView={updateView}
                                onRenameView={async (id, name) => {
                                  await saved.rename.mutateAsync({ id, name });
                                }}
                                onDeleteView={removeView}
                                onCreateRecord={
                                  canEdit()
                                    ? () => void actions.createRecord()
                                    : undefined
                                }
                                canCreateRecord={columns().length > 0}
                                creating={actions.pending()}
                                addColumn={
                                  <Show when={canEdit()}>
                                    <AddColumnMenu
                                      databaseId={databaseId}
                                      tableId={table().table.id}
                                      columns={table().columns}
                                      label="Add column"
                                      onCreated={actions.focusColumn}
                                    />
                                  </Show>
                                }
                              />
                            );
                          }}
                        />
                      )}
                    </Show>
                  </div>
                </div>
              </Show>
            </Show>
          </Show>
        </ErrorBoundary>
      </div>
    </DocumentBlockContainer>
  );
};

function DatabaseSkeleton() {
  return (
    <div
      class="flex min-h-0 flex-1 flex-col gap-3 px-6 py-3"
      aria-busy="true"
      aria-label="Loading database"
    >
      <div class="mb-3 flex gap-2">
        <For each={[0, 1]}>
          {() => <div class="h-7 w-24 animate-pulse rounded-md bg-hover" />}
        </For>
      </div>
      <For each={[0, 1, 2, 3, 4, 5]}>
        {() => <div class="h-9 animate-pulse rounded-md bg-hover" />}
      </For>
    </div>
  );
}

const DatabaseBlock: Component = () => {
  const flag = useFeatureFlag(enableDatabases);
  return (
    <Show
      when={flag().enabled}
      fallback={
        <div class="grid size-full place-items-center p-6 text-sm text-ink-muted">
          Databases are not enabled for this account.
        </div>
      }
    >
      <Block />
    </Show>
  );
};

export default DatabaseBlock;
