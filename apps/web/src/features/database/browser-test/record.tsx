import '@fontsource-variable/inter';
import '../../../index.css';
import { okAsync } from 'neverthrow';
import { render } from 'solid-js/web';
import { macroDarkTheme } from '../../theme/themes/macro-dark';
import { macroLightTheme } from '../../theme/themes/macro-light';
import { themeCssVars } from '../../theme/utils/themeCssVars';
import { DatabaseRelationCell } from '../components/database-relation-cell';
import { GridCell } from '../components/grid-cell';
import { RecordPanel } from '../components/record-panel';
import type { DatabaseViewColumn } from '../core/database-view';
import type { DatabaseRow } from '../core/table';

/**
 * The production record panel with the app's styles: an imported project
 * with long property names and several related tasks. `?theme=dark` uses the
 * dark theme.
 */
const name: DatabaseViewColumn = {
  id: 'name',
  name: 'Name',
  dataType: 'STRING',
  options: [],
  isMultiSelect: false,
  writable: true,
  primary: true,
};
const COLUMNS: DatabaseViewColumn[] = [
  name,
  {
    ...name,
    primary: false,
    id: 'tasks',
    name: 'Tasks',
    relation: { databaseId: 'workspace', tableId: 'tasks' },
  },
  { ...name, primary: false, id: 'readiness', name: 'Launch readiness (%)' },
  { ...name, primary: false, id: 'progress', name: 'Progress (snapshot)' },
];
const TASKS = [
  { id: 'draft', name: 'Draft landing copy' },
  { id: 'vendor', name: 'Pick a CRM vendor' },
  { id: 'review', name: 'Review launch plan' },
];
const ROW: DatabaseRow = {
  rowId: 'launch',
  cells: {
    name: 'Website launch',
    tasks: JSON.stringify(TASKS.map((task) => task.id)),
    readiness: '80',
    progress: '2 of 3',
  },
};
const tasks = {
  name: () => 'Tasks',
  rows: () => TASKS,
  loading: () => false,
  error: () => undefined,
  refresh: () => okAsync(undefined),
};

function Fixture() {
  return (
    <div class="h-dvh bg-panel text-ink">
      <RecordPanel
        row={ROW}
        tableName="Projects"
        columns={COLUMNS}
        canEdit
        pending={false}
        onRetry={() => {}}
        position={0}
        total={3}
        renderCell={(row, column, options) =>
          column().relation ? (
            <DatabaseRelationCell
              {...options}
              column={column()}
              value={row().cells[column().id] ?? null}
              canEdit
              source={tasks}
              onWrite={async () => true}
              onOpen={() => {}}
            />
          ) : (
            <GridCell
              {...options}
              column={column()}
              value={row().cells[column().id] ?? null}
              canEdit
              onWrite={async () => true}
              onAddOption={async () => true}
            />
          )
        }
        onClose={() => {}}
        onNavigate={() => {}}
        onRequestDelete={() => {}}
      />
    </div>
  );
}

const dark = new URLSearchParams(location.search).get('theme') === 'dark';
for (const [key, token] of Object.entries(
  themeCssVars(dark ? macroDarkTheme : macroLightTheme)
))
  document.documentElement.style.setProperty(key, token);
// Boot writes this in the app; the `touch:` styles read it.
document.documentElement.dataset.touchDevice = String(
  matchMedia('(pointer: coarse)').matches
);
const root = document.getElementById('root');
if (root) render(() => <Fixture />, root);
