import { makePersistedState } from '@app/lib/persistence';
import { useCanAutofocusSplitContent } from '@components/app/split-layout/layoutUtils';
import { useNavigatedFromJK } from '@components/app/useNavigatedFromJK';
import { useBlockId } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { deepEqual } from '@core/util/compareUtils';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import DatabaseIcon from '@phosphor/database.svg';
import DownloadIcon from '@phosphor/download-simple.svg';
import LockIcon from '@phosphor/lock-simple.svg';
import SparkleIcon from '@phosphor/sparkle.svg';
import {
  downloadDatabaseSnapshot,
  useDatabaseDetailQuery,
} from '@queries/storage/databases';
import { useDatabaseTableChangedSync } from '@queries/storage/databases-sync';
import { getEntityGraphqlClient } from '@service-storage/graphql-soup';
import { Button } from '@ui';
import {
  type Component,
  createMemo,
  createSignal,
  createUniqueId,
  ErrorBoundary,
  For,
  Show,
  untrack,
} from 'solid-js';
import { DatabaseTitle } from '../components/database-title';
import { DatabaseToolbar } from '../components/database-toolbar';
import {
  type DatabaseViewConfig,
  defaultDatabaseView,
  reconcileDatabaseView,
} from '../core/database-view';
import { renameDatabase } from '../queries/rename-database';
import { useSavedDatabaseViews } from '../queries/saved-database-views';
import { toViewColumn } from '../queries/table-rows';
import { AddColumnMenu } from './AddColumnMenu';
import { DatabaseGrid } from './DatabaseGrid';
import { SqlConsole } from './SqlConsole';
import { TableTabs } from './TableTabs';

type TableViewState = { view: DatabaseViewConfig; selectedViewId?: string };
type ViewSelection = { tableId?: string; views: Record<string, string> };

const Block: Component = () => {
  const databaseId = useBlockId();
  const canAutofocus = useCanAutofocusSplitContent();
  const { navigatedFromJK } = useNavigatedFromJK();
  const questionPanelId = createUniqueId();
  const userId = untrack(useUserId());
  const storage = createUserScopedStorage(
    `database-view-selection:${databaseId}`
  );
  const [selection, setSelection] = makePersistedState(
    createSignal<ViewSelection>({ views: {} }),
    {
      storages: {
        restore: () => {
          if (!userId) return;
          const stored: unknown = JSON.parse(storage.read(userId) ?? 'null');
          if (!stored || typeof stored !== 'object') return;
          const value = stored as Record<string, unknown>;
          return {
            tableId:
              typeof value.tableId === 'string' ? value.tableId : undefined,
            views:
              value.views && typeof value.views === 'object'
                ? Object.fromEntries(
                    Object.entries(value.views).filter(
                      (entry): entry is [string, string] =>
                        typeof entry[1] === 'string'
                    )
                  )
                : {},
          };
        },
        write: (value) => {
          if (userId) storage.write(userId, JSON.stringify(value));
        },
      },
    }
  );
  useDatabaseTableChangedSync(() => databaseId);
  const detailQuery = useDatabaseDetailQuery(() => databaseId);
  let gridEntry: { tableId: string; focus: () => Promise<void> } | undefined;
  let requestedGridEntry = false;
  const enterFirstCell = () => {
    if (!gridEntry || gridEntry.tableId !== activeTableId()) {
      requestedGridEntry = true;
      return;
    }
    requestedGridEntry = false;
    void gridEntry.focus();
  };
  const [consoleOpen, setConsoleOpen] = createSignal(false);
  const [consoleMounted, setConsoleMounted] = createSignal(false);
  let questionPanel: HTMLElement | undefined;
  let aiButton: HTMLButtonElement | undefined;
  const closeConsole = () => {
    setConsoleOpen(false);
    queueMicrotask(() => aiButton?.focus());
  };
  const [downloading, setDownloading] = createSignal(false);
  const [tableViews, setTableViews] = createSignal<
    Record<string, TableViewState>
  >({});
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
    setTableViews((current) => ({ ...current, [tableId]: state }));
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
    setViewState({ view: config, selectedViewId: selectedViewId() });
  }
  function selectView(id?: string) {
    const selected = saved.views().find((entry) => entry.id === id);
    setViewState({
      view: selected?.view ?? defaultDatabaseView(),
      selectedViewId: selected?.id,
    });
  }
  async function saveView(name: string, layout: DatabaseViewConfig['layout']) {
    const tableId = activeTableId();
    const original = view();
    const originalState = tableId ? tableViews()[tableId] : undefined;
    const config = reconcileDatabaseView({ ...original, layout }, columns());
    const id = await saved.save.mutateAsync({ name, view: config });
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
    if (selected)
      await saved.save.mutateAsync({
        id: selected.id,
        name: selected.name,
        view: view(),
      });
  }
  async function removeView(id: string) {
    const tableId = activeTableId();
    const config = view();
    await saved.remove.mutateAsync(id);
    if (tableId && selection().views[tableId] === id) {
      setViewState({ view: tableViews()[tableId]?.view ?? config }, tableId);
    }
  }

  async function downloadSnapshot() {
    if (downloading()) return;
    setDownloading(true);
    let url: string | undefined;
    try {
      const blob = await downloadDatabaseSnapshot(databaseId);
      url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${detail()?.database.name ?? 'database'}.sqlite`;
      document.body.append(link);
      link.click();
      link.remove();
    } catch (error) {
      console.error('database snapshot download failed', error);
      toast.failure('Could not export this database. Please try again.');
    } finally {
      setDownloading(false);
      const objectUrl = url;
      if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
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
            <Button
              variant="ghost"
              size="icon-md"
              label={
                downloading() ? 'Exporting database' : 'Export SQLite database'
              }
              disabled={!detail() || downloading()}
              onClick={downloadSnapshot}
            >
              <DownloadIcon class="size-4" />
            </Button>
            <Button
              ref={aiButton}
              variant={consoleOpen() ? 'accent' : 'ghost'}
              size="sm"
              class="h-8 gap-1.5 px-2 text-xs"
              disabled={!detail()}
              aria-label="Database AI"
              aria-expanded={consoleOpen()}
              aria-controls={questionPanelId}
              onClick={() => {
                const open = !consoleOpen();
                if (open) setConsoleMounted(true);
                setConsoleOpen(open);
                if (open)
                  queueMicrotask(() =>
                    questionPanel?.querySelector('textarea')?.focus()
                  );
              }}
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
                  <div
                    class="min-h-0 min-w-0 flex-1 flex-col @min-[1000px]/database:flex"
                    classList={{ hidden: consoleOpen(), flex: !consoleOpen() }}
                  >
                    <Show when={activeTable()}>
                      {(table) => (
                        <DatabaseGrid
                          databaseId={databaseId}
                          table={table()}
                          canEdit={canEdit()}
                          view={view()}
                          onViewChange={changeView}
                          renderToolbar={(actions) => {
                            gridEntry = {
                              tableId: table().table.id,
                              focus: actions.focusFirstCell,
                            };
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
                  <Show when={consoleMounted() && detail()}>
                    {(current) => (
                      <aside
                        ref={questionPanel}
                        id={questionPanelId}
                        aria-label="Ask your database"
                        class="min-h-0 min-w-0 flex-1 flex-col overflow-hidden @min-[1000px]/database:w-[380px] @min-[1000px]/database:flex-none @min-[1000px]/database:border-l @min-[1000px]/database:border-edge-muted"
                        classList={{
                          flex: consoleOpen(),
                          hidden: !consoleOpen(),
                        }}
                      >
                        <SqlConsole
                          detail={current()}
                          activeTableId={activeTableId()}
                          onClose={closeConsole}
                        />
                      </aside>
                    )}
                  </Show>
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

export default Block;
