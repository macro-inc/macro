import { openChatWithInput } from '@app/features/chat/ChatWithAgentButton';
import { toQuerySchema } from '@app/features/database-query/queries/query-source';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import { useSplitLayout } from '@components/app/split-layout/layout';
import {
  returnSplitToRecentListView,
  useCanAutofocusSplitContent,
  useSplitPanelOrThrow,
} from '@components/app/split-layout/layoutUtils';
import { useNavigatedFromJK } from '@components/app/useNavigatedFromJK';
import { useHasPaidAccess } from '@core/auth/license';
import { useBlockId } from '@core/block';
import { DATABASE_MODEL, modelsForPlan } from '@core/component/AI/constant';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { toast } from '@core/component/Toast/Toast';
import { enableDatabases, enableForms } from '@core/constant/featureFlags';
import { PaywallKey, usePaywallState } from '@core/constant/PaywallState';
import { useUserId } from '@core/context/user';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { createMethodRegistration } from '@core/orchestrator';
import { blockHandleSignal } from '@core/signal/load';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import {
  onDatabaseBatchCommitted,
  undoDatabaseChange,
  useDatabaseDetailQuery,
} from '@queries/storage/databases';
import { useDatabaseTableChangedSync } from '@queries/storage/databases-sync';
import type { DatabaseView } from '@service-storage/generated/schemas/databaseView';
import { getEntityGraphqlClient } from '@service-storage/graphql-soup';
import { Button } from '@ui';
import { okAsync } from 'neverthrow';
import {
  type Component,
  createMemo,
  createSignal,
  ErrorBoundary,
  For,
  lazy,
  onCleanup,
  Show,
  Suspense,
} from 'solid-js';
import { match } from 'ts-pattern';
import { DatabaseSearch } from '../../database/components/database-search';
import type { ShownLayout } from '../../database/components/database-toolbar';
import { DatabaseToolbar } from '../../database/components/database-toolbar';
import type {
  NewFormChoice,
  NewView,
} from '../../database/components/new-view-dialog';
import type { DatabaseRelatedDestination } from '../../database/core/database-relations';
import type { ViewChange } from '../../database/core/view-state';
import { allRecordsView, boardLayout } from '../../database/core/views';
import { databaseOpMessage } from '../../database/core/write-failure';
import { createDatabaseSearch } from '../../database/primitives/database-search';
import { createDatabaseUndo } from '../../database/primitives/undo-controller';
import { createViewCreation } from '../../database/primitives/view-creation';
import { databaseChat } from '../core/chat-context';
import { createDatabaseViewSelection } from '../primitives/view-selection';
import { searchDatabase } from '../queries/database-search';
import { toViewColumn } from '../queries/table-rows';
import { trashDatabase } from '../queries/trash-database';
import { prepareViewCreation } from '../queries/view-creation';
import {
  deleteDatabaseView,
  reorderDatabaseViews,
  showAsBoardWithStatusColumn,
  updateDatabaseView,
} from '../queries/views';
import { DatabaseGrid } from './DatabaseGrid';
import { DatabasePageShell } from './DatabasePageShell';
import { DatabaseSidePanelSections } from './sidepanel/DatabaseSidePanelSections';
import { TopBar } from './TopBar';

// Forms load only when the flag is on, and only through this boundary.
const DatabaseFormCreation = lazy(async () => ({
  default: (await import('@app/features/block-form/database-forms-entry'))
    .DatabaseFormCreation,
}));

const Block: Component = () => {
  const databaseId = useBlockId();
  const panel = useSplitPanelOrThrow();
  const { replaceOrInsertSplit } = useSplitLayout();
  const orchestrator = useGlobalBlockOrchestrator();
  let requestedRecord: DatabaseRelatedDestination | undefined;
  const canAutofocus = useCanAutofocusSplitContent();
  const { navigatedFromJK } = useNavigatedFromJK();
  const userId = useUserId();
  const storage = createUserScopedStorage(
    `database-view-selection:${databaseId}`
  );
  const [selection, setSelection] = createDatabaseViewSelection(
    userId,
    storage
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
    // Another table's grid takes the request when it mounts.
    openRequestedRecord();
  }
  createMethodRegistration(blockHandleSignal.get, {
    goToLocationFromParams: (params: Record<string, string>) => {
      if (params.tableId && params.viewId)
        setSelection((current) => ({
          ...current,
          tableId: params.tableId,
          views: { ...current.views, [params.tableId]: params.viewId },
        }));
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
  const hasPaidAccess = useHasPaidAccess();
  const { showPaywall } = usePaywallState();
  async function openDatabaseChat() {
    const current = detail();
    if (!current || openingChat()) return;
    setOpeningChat(true);
    // A locked model gets the picker's treatment: the chat opens on the plan's
    // model and the paywall says why.
    const canUseDatabaseModel = modelsForPlan(hasPaidAccess()).includes(
      DATABASE_MODEL
    );
    const chat = databaseChat(toQuerySchema(current, activeTableId()));
    try {
      await openChatWithInput(chat.input, {
        instructions: chat.instructions,
        ...(canUseDatabaseModel ? { model: DATABASE_MODEL } : {}),
      });
      if (!canUseDatabaseModel) showPaywall(PaywallKey.O1_LIMIT);
    } finally {
      setOpeningChat(false);
    }
  }
  // Reading data only after status resolves keeps the database shell mounted.
  const detail = () => (!detailQuery.isPending ? detailQuery.data : undefined);
  const tables = () => detail()?.tables ?? [];
  const activeTable = createMemo(
    () =>
      tables().find((table) => table.table.id === selection().tableId) ??
      tables()[0]
  );
  const activeTableId = () => activeTable()?.table.id;
  // A memo, so a refetched schema with the same grant wakes no cell.
  const canEdit = createMemo(
    () => detail()?.grant === 'edit' || detail()?.grant === 'owner'
  );
  const columns = () => activeTable()?.columns.map(toViewColumn) ?? [];
  const formsFlag = useFeatureFlag(enableForms);
  const [newForm, setNewForm] = createSignal<NewFormChoice>();
  const creations = createViewCreation();
  const storedViews = () => {
    const drafts = creations
      .drafts()
      .filter((item) => item.view.tableId === activeTableId());
    return [
      ...(activeTable()?.views ?? []).filter(
        (view) => !drafts.some((item) => item.view.id === view.id)
      ),
      ...drafts.map((item) => item.view),
    ];
  };
  const activeCreation = () =>
    creations.drafts().find((item) => item.view.id === selectedView()?.id);
  const selectedView = () => {
    const tableId = activeTableId();
    const id = tableId ? selection().views[tableId] : undefined;
    return storedViews().find((view) => view.id === id);
  };
  /** All records, as this viewer has filtered, sorted and laid it out, per table. */
  const [allRecords, setAllRecords] = createSignal<
    Record<string, DatabaseView>
  >({});
  const search = createDatabaseSearch({ detail, search: searchDatabase });
  registerHotkey({
    hotkey: 'cmd+f',
    hotkeyToken: TOKENS.database.search,
    scopeId: panel.splitHotkeyScope,
    description: 'Search database',
    runWithInputFocused: true,
    keyDownHandler: () => {
      search.open();
      return true;
    },
  });
  const databaseUndo = createDatabaseUndo({
    undoChange: (change) => undoDatabaseChange(databaseId, change),
    onCommitted: (listener) => {
      const stop = onDatabaseBatchCommitted((batch) => {
        if (batch.databaseId !== databaseId) return;
        listener({
          ops: batch.ops,
          changes: batch.changes.map(({ change }) => change),
        });
      });
      onCleanup(stop);
    },
    offer: (label, undo) =>
      toast.success(label, { actions: [{ label: 'Undo', onClick: undo }] }),
  });
  // Without input focus, so a cell editor keeps Ctrl+Z for its own text.
  registerHotkey({
    hotkey: 'cmd+z',
    hotkeyToken: TOKENS.database.undo,
    scopeId: panel.splitHotkeyScope,
    description: 'Undo your last edit',
    condition: databaseUndo.canUndo,
    keyDownHandler: () => {
      void databaseUndo.undo();
      return true;
    },
  });
  registerHotkey({
    hotkey: 'shift+cmd+z',
    hotkeyToken: TOKENS.database.redo,
    scopeId: panel.splitHotkeyScope,
    description: 'Redo your last undo',
    condition: databaseUndo.canRedo,
    keyDownHandler: () => {
      void databaseUndo.redo();
      return true;
    },
  });
  const view = (): DatabaseView | undefined => {
    const table = activeTable();
    if (!table) return undefined;
    return (
      selectedView() ??
      allRecords()[table.table.id] ??
      allRecordsView(table.table)
    );
  };
  function selectView(id?: string) {
    const tableId = activeTableId();
    if (!tableId) return;
    setSelection((current) => {
      const views = { ...current.views };
      if (id) views[tableId] = id;
      else delete views[tableId];
      return { ...current, views };
    });
  }
  function changeView(change: ViewChange) {
    if (activeCreation()) return;
    const current = view();
    if (!current) return;
    const stored = selectedView();
    if (stored) {
      void updateDatabaseView(stored, change).mapErr((failure) =>
        toast.failure(databaseOpMessage(failure, 'this view'))
      );
      return;
    }
    setAllRecords((views) => ({
      ...views,
      [current.tableId]: { ...current, ...change },
    }));
  }
  function createView(current: DatabaseView, created: NewView) {
    const creation = prepareViewCreation(current, created, columns());
    creations.start(creation);
    selectView(creation.view.id);
    return okAsync(undefined);
  }
  /** Lay a stored view out as a table, or as a board grouped as asked. */
  function showViewAs(target: DatabaseView, shown: ShownLayout) {
    return match(shown)
      .with({ kind: 'table' }, () =>
        updateDatabaseView(target, { layout: { kind: 'table', columns: [] } })
      )
      .with({ kind: 'board', groupBy: { kind: 'column' } }, ({ groupBy }) =>
        updateDatabaseView(target, {
          layout: boardLayout(groupBy.columnId, columns()),
        })
      )
      .with({ kind: 'board', groupBy: { kind: 'new-status' } }, () =>
        showAsBoardWithStatusColumn(target, columns())
      )
      .exhaustive()
      .map(() => undefined);
  }

  return (
    <DocumentBlockContainer>
      <DatabasePageShell>
        <DatabaseSidePanelSections
          databaseId={databaseId}
          database={detail()?.database}
        />
        <Show when={formsFlag().enabled}>
          <Suspense>
            <DatabaseFormCreation
              databaseId={databaseId}
              tableId={activeTableId()}
              tableName={activeTable()?.table.name}
              isOwner={detail()?.grant === 'owner'}
              onChoice={setNewForm}
            />
          </Suspense>
        </Show>
        <TopBar
          databaseId={databaseId}
          detail={detail()}
          canEdit={canEdit()}
          activeTable={activeTable()}
          autoFocusTitle={
            canAutofocus &&
            !navigatedFromJK() &&
            detail()?.database.name === 'Untitled database'
          }
          onTitleConfirm={enterFirstCell}
          onSelectTable={(tableId) =>
            setSelection((current) => ({ ...current, tableId }))
          }
          onDelete={() =>
            trashDatabase(getEntityGraphqlClient(), databaseId).map(() =>
              returnSplitToRecentListView(panel.handle)
            )
          }
          openingChat={openingChat()}
          onOpenChat={() => void openDatabaseChat()}
        />
        <div
          class="@container/database flex size-full min-h-0 min-w-0 flex-col overflow-hidden bg-canvas-base text-ink"
          style={{ '--database-title-column-width': '18rem' }}
        >
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
                  <Show
                    when={
                      activeTable() && view()
                        ? { table: activeTable()!, view: view()! }
                        : undefined
                    }
                  >
                    {(shown) => {
                      const table = () => shown().table;
                      return (
                        <>
                          <Show when={activeCreation()?.failure}>
                            {(failure) => (
                              <div
                                role="alert"
                                class="flex items-center gap-3 px-5 py-2 text-sm text-failure-ink"
                              >
                                <span>
                                  {databaseOpMessage(failure(), 'this view')}
                                </span>
                                <Button
                                  size="sm"
                                  onClick={() =>
                                    creations.retry(shown().view.id)
                                  }
                                >
                                  Retry
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    creations.discard(shown().view.id);
                                    selectView();
                                  }}
                                >
                                  Dismiss
                                </Button>
                              </div>
                            )}
                          </Show>
                          <DatabaseGrid
                            databaseId={databaseId}
                            table={table()}
                            canEdit={canEdit() && !activeCreation()}
                            view={shown().view}
                            stored={!!selectedView() && !activeCreation()}
                            preparingView={!!activeCreation()?.needsColumn}
                            onViewChange={changeView}
                            onClearConstraints={() => {
                              changeView({
                                query: {
                                  ...shown().view.query,
                                  filter: null,
                                },
                              });
                            }}
                            onOpenRelated={openRelated}
                            actionsRef={(actions) => {
                              gridEntry = {
                                tableId: table().table.id,
                                focus: actions.focusFirstCell,
                                openRecord: actions.openRecord,
                              };
                              openRequestedRecord();
                              if (requestedGridEntry) enterFirstCell();
                            }}
                            renderToolbar={(actions) => (
                              <DatabaseToolbar
                                columns={columns()}
                                views={storedViews()}
                                view={shown().view}
                                selectedViewId={selectedView()?.id}
                                canEdit={canEdit() && !activeCreation()}
                                newForm={newForm()}
                                search={
                                  <DatabaseSearch
                                    term={search.term()}
                                    isOpen={search.isOpen()}
                                    results={search.results()}
                                    onTermChange={search.setTerm}
                                    onOpen={search.open}
                                    onClose={search.close}
                                    inputRef={search.setInput}
                                    onChoose={(choice) =>
                                      void openRelated({
                                        databaseId,
                                        ...choice,
                                      })
                                    }
                                  />
                                }
                                onSelectView={selectView}
                                onChangeView={changeView}
                                onCreateView={(created) =>
                                  createView(shown().view, created)
                                }
                                onRenameView={(target, name) =>
                                  updateDatabaseView(target, { name }).map(
                                    () => undefined
                                  )
                                }
                                onShowViewAs={showViewAs}
                                onDeleteView={(target) => {
                                  if (selectedView()?.id === target.id)
                                    selectView();
                                  return deleteDatabaseView(target);
                                }}
                                onReorderViews={(order) =>
                                  void reorderDatabaseViews(
                                    databaseId,
                                    table().table.id,
                                    order
                                  ).mapErr((failure) =>
                                    toast.failure(
                                      databaseOpMessage(failure, 'these views')
                                    )
                                  )
                                }
                                onCreateRecord={
                                  canEdit()
                                    ? () => void actions.createRecord()
                                    : undefined
                                }
                                canCreateRecord={columns().length > 0}
                                creating={actions.pending()}
                              />
                            )}
                          />
                        </>
                      );
                    }}
                  </Show>
                </Show>
              </Show>
            </Show>
          </ErrorBoundary>
        </div>
      </DatabasePageShell>
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
