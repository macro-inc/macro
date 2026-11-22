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
 * with long property names and several related tasks. `?tasks=many` relates
 * eight tasks, `?tasks=long` one with a long name and one with a long unbroken name, `?tasks=unavailable` one the
 * source cannot resolve; `?theme=dark` uses the dark theme.
 */
const params = new URLSearchParams(location.search);
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
  {
    ...name,
    primary: false,
    id: 'score',
    name: 'Launch readiness score (percent)',
  },
];
const TASKS = [
  { id: 'draft', name: 'Draft landing copy' },
  { id: 'vendor', name: 'Pick a CRM vendor' },
  { id: 'review', name: 'Review launch plan' },
  { id: 'pricing', name: 'Publish the pricing page' },
  { id: 'press', name: 'Brief the press list' },
  { id: 'docs', name: 'Update the help center' },
  { id: 'qa', name: 'Run the launch checklist' },
  { id: 'retro', name: 'Hold the launch retro' },
  {
    id: 'long',
    name: 'Coordinate the migration of every legacy customer workspace before launch',
  },
  { id: 'token', name: 'pre-launch-checklist-v2-final-final-revised-copy' },
];
const RELATED = (() => {
  const variant = params.get('tasks');
  if (variant === 'many') return TASKS.slice(0, 8).map((task) => task.id);
  if (variant === 'long') return ['draft', 'long', 'token'];
  if (variant === 'unavailable') return ['draft', 'deleted-task'];
  return ['draft', 'vendor', 'review'];
})();
const ROW: DatabaseRow = {
  rowId: 'launch',
  cells: {
    name: 'Website launch',
    tasks: JSON.stringify(RELATED),
    readiness: '80',
    progress: '2 of 3',
    score: '80',
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

const dark = params.get('theme') === 'dark';
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
