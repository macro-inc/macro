import { openDocument } from '@core/component/LexicalMarkdown/component/core/BlockLink';
import { toast } from '@core/component/Toast/Toast';
import ArrowSquareOut from '@phosphor/arrow-square-out.svg';
import DatabaseIcon from '@phosphor/database.svg';
import FunnelIcon from '@phosphor/funnel.svg';
import SortIcon from '@phosphor/sort-ascending.svg';
import {
  onDatabaseBatchCommitted,
  undoDatabaseChange,
  useDatabaseDetailQuery,
} from '@queries/storage/databases';
import { useDatabaseTableChangedSync } from '@queries/storage/databases-sync';
import type { DatabaseView } from '@service-storage/generated/schemas/databaseView';
import { getEntityGraphqlClient } from '@service-storage/graphql-soup';
import { Button } from '@ui';
import { createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import { DatabaseTitle } from '../database/components/database-title';
import {
  FilterPanel,
  filterConditionCount,
} from '../database/components/database-view-filters';
import { SortPanel } from '../database/components/sort-panel';
import { ToolbarPopover } from '../database/components/view-control-popover';
import type { DatabaseRelatedDestination } from '../database/core/database-relations';
import type { ViewChange } from '../database/core/view-state';
import { allRecordsView } from '../database/core/views';
import { databaseEntityMessage } from '../database/core/write-failure';
import { createDatabaseUndo } from '../database/primitives/undo-controller';
import { DatabaseGrid } from './component/DatabaseGrid';
import { renameDatabase } from './queries/rename-database';
import { toViewColumn } from './queries/table-rows';

/** The Macro database editor hosted in markdown, without a nested app block. */
export function DocumentDatabase(props: {
  databaseId: string;
  name: string;
  params?: Record<string, string>;
  collapsed?: boolean;
  onToggle: () => void;
  onLocationChange?: (params: Record<string, string>) => void;
}) {
  const databaseId = props.databaseId;
  useDatabaseTableChangedSync(() => databaseId);
  const detail = useDatabaseDetailQuery(() => databaseId);
  const [location, setLocation] = createSignal(props.params ?? {});
  const [changedViews, setChangedViews] = createSignal<
    Record<string, DatabaseView>
  >({});
  const tables = () => (detail.isSuccess ? detail.data.tables : []);
  const table = createMemo(() => {
    const id = location().tableId;
    return id ? tables().find((entry) => entry.table.id === id) : tables()[0];
  });
  const canEdit = createMemo(
    () =>
      detail.isSuccess &&
      (detail.data.grant === 'edit' || detail.data.grant === 'owner')
  );
  const name = () =>
    detail.isSuccess ? detail.data.database.name : props.name;
  const baseView = () => {
    const current = table();
    if (!current) return;
    return (
      current.views.find((view) => view.id === location().viewId) ??
      allRecordsView(current.table)
    );
  };
  const view = () => {
    const base = baseView();
    return base && (changedViews()[base.id] ?? base);
  };
  // Filters, sorting and column widths belong to this visit, not the shared view.
  const changeView = (change: ViewChange) => {
    const current = view();
    if (current)
      setChangedViews((views) => ({
        ...views,
        [current.id]: { ...current, ...change },
      }));
  };
  const selectLocation = (next: Record<string, string>) => {
    setLocation(next);
    props.onLocationChange?.(next);
  };
  const open = (
    target: { databaseId: string } & Record<string, string> = {
      databaseId,
      ...location(),
      tableId: table()?.table.id ?? '',
      viewId: view()?.id ?? '',
    }
  ) => openDocument('database', target.databaseId, target, true);
  const openRelated = (target: DatabaseRelatedDestination) => open(target);
  const undo = createDatabaseUndo({
    undoChange: (change) => undoDatabaseChange(databaseId, change),
    onCommitted: (listener) =>
      onCleanup(
        onDatabaseBatchCommitted((batch) => {
          if (batch.databaseId === databaseId)
            listener({
              ops: batch.ops,
              changes: batch.changes.map(({ change }) => change),
            });
        })
      ),
    offer: (label, revert) =>
      toast.success(label, { actions: [{ label: 'Undo', onClick: revert }] }),
  });

  return (
    <section
      aria-label={`Database: ${name()}`}
      contentEditable={false}
      data-lexical-interactive
      class="@container/database my-2 flex min-w-0 flex-col overflow-hidden rounded-lg border border-edge-muted bg-panel text-ink"
      onKeyDown={(event) => {
        // The card's event boundary keeps these out of outer Lexical.
        event.stopPropagation();
        const target = event.target;
        const editable =
          target instanceof Element &&
          target.closest('[contenteditable="true"]');
        const typing =
          target instanceof Element &&
          (target.closest('input, textarea') ||
            (editable && event.currentTarget.contains(editable)));
        if (
          typing ||
          !(event.metaKey || event.ctrlKey) ||
          event.key.toLowerCase() !== 'z'
        )
          return;
        event.preventDefault();
        if (event.shiftKey) void undo.redo();
        else void undo.undo();
      }}
    >
      <div class="flex min-w-0 flex-wrap items-center gap-2 px-3 py-2">
        <DatabaseIcon class="size-4 shrink-0 text-ink-muted" />
        <div class="min-w-0 flex-1">
          <DatabaseTitle
            name={name()}
            canEdit={canEdit() && !props.collapsed}
            onRename={(next) =>
              void renameDatabase(
                getEntityGraphqlClient(),
                databaseId,
                next
              ).mapErr((failure) =>
                toast.failure(databaseEntityMessage(failure, 'rename'))
              )
            }
          />
        </div>
        <Show when={detail.isSuccess && !canEdit()}>
          <span class="text-xs text-ink-muted">Read only</span>
        </Show>
        <Button variant="ghost" size="sm" onClick={() => open()}>
          <ArrowSquareOut class="size-3.5" /> Open
        </Button>
        <Button variant="ghost" size="sm" onClick={props.onToggle}>
          {props.collapsed ? 'Expand' : 'Collapse'}
        </Button>
      </div>
      <Show when={!props.collapsed}>
        <Show
          when={detail.isSuccess}
          fallback={
            <div class="px-3 py-5 text-sm text-ink-muted">
              <Show
                when={detail.isError}
                fallback={<span role="status">Loading database…</span>}
              >
                <p role="alert">
                  This database is unavailable. It may have been deleted or you
                  may not have access.
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void detail.refetch()}
                >
                  Retry
                </Button>
              </Show>
            </div>
          }
        >
          <Show
            when={table()}
            fallback={
              <p role="alert" class="px-3 py-5 text-sm text-ink-muted">
                This table no longer exists. Open the database to choose another
                table.
              </p>
            }
          >
            {(shown) => (
              <Show when={view()}>
                {(currentView) => (
                  <div class="flex h-96 min-h-0 flex-col border-t border-edge-muted">
                    <DatabaseGrid
                      databaseId={databaseId}
                      table={shown()}
                      canEdit={canEdit()}
                      view={currentView()}
                      stored={false}
                      onViewChange={changeView}
                      onClearConstraints={() =>
                        changeView({
                          query: { ...currentView().query, filter: null },
                        })
                      }
                      onOpenRelated={openRelated}
                      renderToolbar={(actions) => (
                        <div class="flex flex-wrap items-center gap-1 border-b border-edge-muted px-3 py-1.5">
                          <select
                            aria-label="Database table"
                            class="min-w-0 max-w-40 bg-transparent text-xs outline-none focus-visible:ring-2 focus-visible:ring-edge-focus"
                            value={shown().table.id}
                            onChange={(event) =>
                              selectLocation({
                                ...location(),
                                tableId: event.currentTarget.value,
                                viewId: '',
                              })
                            }
                          >
                            <For each={tables()}>
                              {(entry) => (
                                <option value={entry.table.id}>
                                  {entry.table.name}
                                </option>
                              )}
                            </For>
                          </select>
                          <div class="flex-1" />
                          <ToolbarPopover
                            label="Filter"
                            count={filterConditionCount(
                              currentView().query.filter
                            )}
                            icon={<FunnelIcon class="size-3.5" />}
                          >
                            <FilterPanel
                              columns={shown().columns.map(toViewColumn)}
                              filter={currentView().query.filter}
                              onChange={(filter) =>
                                changeView({
                                  query: { ...currentView().query, filter },
                                })
                              }
                            />
                          </ToolbarPopover>
                          <ToolbarPopover
                            label="Sort"
                            count={currentView().query.sort?.length}
                            icon={<SortIcon class="size-3.5" />}
                          >
                            <SortPanel
                              columns={shown().columns.map(toViewColumn)}
                              view={currentView()}
                              onChange={changeView}
                            />
                          </ToolbarPopover>
                          <Show when={canEdit()}>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={actions.pending()}
                              onClick={() => void actions.createRecord()}
                            >
                              New row
                            </Button>
                          </Show>
                        </div>
                      )}
                    />
                  </div>
                )}
              </Show>
            )}
          </Show>
        </Show>
      </Show>
    </section>
  );
}
