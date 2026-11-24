import '@fontsource-variable/inter';
import '../../../index.css';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { DatabaseView } from '@service-storage/generated/schemas/databaseView';
import { okAsync } from 'neverthrow';
import { createSignal, Show, Suspense } from 'solid-js';
import { render } from 'solid-js/web';
import {
  DatabasePageNoTables,
  DatabasePageToolbar,
} from '../../block-database/database-page-controls';
import { macroLightTheme } from '../../theme/themes/macro-light';
import { themeCssVars } from '../../theme/utils/themeCssVars';
import { DatabaseSearch } from '../components/database-search';
import type { DatabaseToolbarProps } from '../components/database-toolbar';
import type { CreateTable } from '../core/table-creation';

/**
 * The database page's toolbar, as the page draws it, with the app's styles
 * over tables and views kept in memory: the touch view on a touch device, the
 * desktop bar otherwise. `?selected=<view id>` opens on that view, `?empty`
 * starts without tables, and `?unready` makes the first New table leave its
 * table created but not loaded.
 */
const params = new URLSearchParams(location.search);
document.documentElement.dataset.touchDevice = String(isTouchDevice());

const VIEW_NAMES = [
  'Active',
  'Needs review before the quarterly business review',
  'By owner',
  'Overdue',
  'This week',
  'Archived vendors',
  'High priority and blocked items',
  'Recently changed',
];

function storedView(id: string, name: string): DatabaseView {
  return {
    id,
    databaseId: 'database',
    tableId: 'table',
    name,
    position: id,
    query: { filter: null, sort: [] },
    layout: { kind: 'table', columns: [] },
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  };
}

const INITIAL_TABLES = [
  { id: 'table-1', name: 'Vendors' },
  { id: 'table-2', name: 'Contract renewals for the coming fiscal year' },
  { id: 'table-3', name: 'Invoices' },
];

function ToolbarFixture() {
  const [views, setViews] = createSignal(
    VIEW_NAMES.map((name, index) => storedView(`view-${index + 1}`, name))
  );
  const [selected, setSelected] = createSignal(
    params.get('selected') ?? undefined
  );
  const [tables, setTables] = createSignal(
    params.has('empty') ? [] : INITIAL_TABLES
  );
  const [table, setTable] = createSignal(
    params.has('empty') ? undefined : 'table-2'
  );
  const [tableMenuFocus, setTableMenuFocus] = createSignal<string>();
  let createCalls = 0;
  const createTable: CreateTable = (name, existingTableId) => {
    createCalls += 1;
    if (existingTableId)
      return okAsync({ tableId: existingTableId, ready: true });

    const id = `table-${tables().length + 1}`;
    setTables((current) => [...current, { id, name }]);
    if (params.has('unready') && createCalls === 1)
      return okAsync({
        tableId: id,
        ready: false,
        message: 'Your table is ready, but could not be loaded.',
      });

    return okAsync({ tableId: id, ready: true });
  };
  const [term, setTerm] = createSignal('');
  const [searching, setSearching] = createSignal(false);
  const allRecords = storedView('all-records', 'All records');
  const view = () =>
    views().find((stored) => stored.id === selected()) ?? allRecords;

  const toolbar: DatabaseToolbarProps = {
    columns: [],
    get views() {
      return views();
    },
    get view() {
      return view();
    },
    get selectedViewId() {
      return selected();
    },
    canEdit: true,
    get search() {
      return (
        <DatabaseSearch
          term={term()}
          isOpen={searching()}
          results={{ status: 'idle' }}
          onTermChange={setTerm}
          onOpen={() => setSearching(true)}
          onClose={() => setSearching(false)}
          inputRef={() => {}}
          onChoose={() => {}}
        />
      );
    },
    onSelectView: setSelected,
    onChangeView: () => {},
    onCreateView: (created) => {
      const id = `view-${views().length + 1}`;
      setViews((current) => [...current, storedView(id, created.name)]);
      setSelected(id);
      return okAsync(undefined);
    },
    onRenameView: (target, name) => {
      setViews((current) =>
        current.map((stored) =>
          stored.id === target.id ? { ...stored, name } : stored
        )
      );
      return okAsync(undefined);
    },
    onShowViewAs: () => okAsync(undefined),
    onDeleteView: (target) => {
      setViews((current) =>
        current.filter((stored) => stored.id !== target.id)
      );
      setSelected(undefined);
      return okAsync(undefined);
    },
    onCreateRecord: () => {},
    canCreateRecord: true,
  };

  return (
    <main class="flex h-screen flex-col bg-canvas-base text-ink">
      {/* The database page draws its toolbar again for each table, under
          the records' loading boundary. */}
      <Suspense>
        <Show
          when={table()}
          keyed
          fallback={
            <DatabasePageNoTables
              onCreateTable={createTable}
              onOpenTable={setTable}
            />
          }
        >
          {(activeTableId) => (
            <DatabasePageToolbar
              {...toolbar}
              tables={tables()}
              activeTableId={activeTableId}
              onSelectTable={(tableId) => {
                setTableMenuFocus(tableId);
                setTable(tableId);
              }}
              onCreateTable={createTable}
              tableMenuItems={undefined}
              focusTableMenu={tableMenuFocus() === activeTableId}
              onTableMenuFocused={() => setTableMenuFocus(undefined)}
            />
          )}
        </Show>
      </Suspense>
      <output aria-label="Tables">{tables().length}</output>
    </main>
  );
}

document.documentElement.dataset.themeLight = 'true';
for (const [name, value] of Object.entries(themeCssVars(macroLightTheme)))
  document.documentElement.style.setProperty(name, value);
const root = document.getElementById('root');
if (root) render(() => <ToolbarFixture />, root);
