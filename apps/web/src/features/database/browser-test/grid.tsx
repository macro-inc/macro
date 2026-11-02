import '@fontsource-variable/inter';
import '../../../index.css';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { macroDarkTheme } from '../../theme/themes/macro-dark';
import { macroLightTheme } from '../../theme/themes/macro-light';
import { themeCssVars } from '../../theme/utils/themeCssVars';
import type { DatabaseCellPresence } from '../components/database-table';
import { GridCell } from '../components/grid-cell';
import type { DatabaseViewColumn } from '../core/database-view';
import type { DatabaseRow } from '../core/table';
import { DatabaseTableView } from '../views/database-table-view';

/**
 * The production grid with the app's styles, so remote presence can be
 * measured and screenshotted without a signed-in app. Tests drive the
 * collaborators through `window.setRemoteUsers`.
 */
const title: DatabaseViewColumn = {
  id: 'title',
  name: 'Title',
  dataType: 'STRING',
  options: [],
  isMultiSelect: false,
  writable: true,
};
const COLUMNS: DatabaseViewColumn[] = [
  title,
  { ...title, id: 'owner', name: 'Owner' },
  { ...title, id: 'notes', name: 'Notes' },
];
const ROWS: DatabaseRow[] = Array.from({ length: 30 }, (_, index) => ({
  rowId: `row-${index}`,
  cells: {
    title: `Task ${index + 1}`,
    owner: index % 2 ? 'Sam' : 'Alex',
    // One row wraps onto several lines.
    notes:
      index === 3
        ? 'A long note that wraps onto several lines in a narrow column, so its row is taller than the others.'
        : `Note ${index + 1}`,
  },
}));

const [remoteUsers, setRemoteUsers] = createSignal<DatabaseCellPresence[]>([]);
Reflect.set(window, 'setRemoteUsers', setRemoteUsers);

function Fixture() {
  return (
    <div class="flex h-dvh flex-col bg-panel text-ink">
      <DatabaseTableView
        name="Tasks"
        rows={ROWS}
        columns={COLUMNS}
        titleColumnId="title"
        sort={[]}
        widths={{ title: 180, owner: 140, notes: 220 }}
        canEdit
        pending={false}
        getRowTitle={(row) => String(row.cells.title)}
        onOpen={() => {}}
        onSort={() => {}}
        remoteUsers={remoteUsers()}
        renderCell={(row, column, options) => (
          <GridCell
            column={column()}
            value={row().cells[column().id] ?? null}
            canEdit
            onWrite={async () => true}
            onAddOption={async () => true}
            {...options}
          />
        )}
      />
    </div>
  );
}

const dark = new URLSearchParams(location.search).get('theme') === 'dark';
for (const [key, token] of Object.entries(
  themeCssVars(dark ? macroDarkTheme : macroLightTheme)
))
  document.documentElement.style.setProperty(key, token);
const root = document.getElementById('root');
if (root) render(() => <Fixture />, root);
