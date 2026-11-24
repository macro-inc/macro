import '@fontsource-variable/inter';
import '../../../index.css';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { DatabaseView } from '@service-storage/generated/schemas/databaseView';
import { okAsync } from 'neverthrow';
import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { macroLightTheme } from '../../theme/themes/macro-light';
import { themeCssVars } from '../../theme/utils/themeCssVars';
import { DatabaseSearch } from '../components/database-search';
import {
  DatabaseToolbar,
  type DatabaseToolbarProps,
} from '../components/database-toolbar';
import { MobileDatabaseToolbar } from '../views/mobile/database-toolbar';
import { TablePicker } from '../views/mobile/table-picker';

/**
 * The production view toolbars with the app's styles over tables and views
 * kept in memory. `?mobile` draws the touch view's toolbar with its table
 * switcher, the desktop toolbar otherwise; `?selected=<view id>` opens on
 * that view.
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
  const [tables, setTables] = createSignal(INITIAL_TABLES);
  const [table, setTable] = createSignal('table-2');
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
      <Show
        when={params.has('mobile')}
        fallback={<DatabaseToolbar {...toolbar} />}
      >
        {/* The database page draws its toolbar again for each table. */}
        <Show when={table()} keyed>
          {(activeTableId) => (
            <MobileDatabaseToolbar
              {...toolbar}
              tables={
                <TablePicker
                  tables={tables()}
                  activeTableId={activeTableId}
                  onSelect={setTable}
                  onCreate={(name) => {
                    const id = `table-${tables().length + 1}`;
                    setTables((current) => [...current, { id, name }]);
                    return okAsync({ tableId: id, ready: true });
                  }}
                />
              }
            />
          )}
        </Show>
      </Show>
    </main>
  );
}

document.documentElement.dataset.themeLight = 'true';
for (const [name, value] of Object.entries(themeCssVars(macroLightTheme)))
  document.documentElement.style.setProperty(name, value);
const root = document.getElementById('root');
if (root) render(() => <ToolbarFixture />, root);
