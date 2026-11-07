import '@fontsource-variable/inter';
import '../../../index.css';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { macroDarkTheme } from '../../theme/themes/macro-dark';
import { macroLightTheme } from '../../theme/themes/macro-light';
import { themeCssVars } from '../../theme/utils/themeCssVars';
import { toCellTimeRange } from '../core/cell-date-range';
import type { DatabaseViewColumn } from '../core/database-view';
import type { DatabaseRow } from '../core/table';
import type { DatabaseViewState } from '../core/view-state';
import { DatabaseTimelineView } from '../views/database-timeline-view';

/**
 * The production timeline with the app's styles and a host that keeps its
 * records in memory. `?grouped` groups by stage, `?empty` starts without
 * records, `?theme=dark` uses the dark theme.
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
    id: 'dates',
    name: 'Dates',
    dataType: 'DATE_RANGE',
  },
  {
    ...name,
    primary: false,
    id: 'stage',
    name: 'Stage',
    dataType: 'SELECT_STRING',
    options: [
      { id: 'plan', label: 'Plan', color: '#0091FF' },
      { id: 'build', label: 'Build', color: '#8E4EC6' },
      { id: 'ship', label: 'Ship', color: '#46A758' },
    ],
  },
];

/** Midnight `offset` days from today, local time. */
function day(offset: number) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return date;
}

function allDay(start: number, end: number) {
  return toCellTimeRange({ allDay: true, start: day(start), end: day(end) });
}

function timed(offset: number, startHour: number, endHour: number) {
  const start = day(offset);
  start.setHours(startHour);
  const end = day(offset);
  end.setHours(endHour);
  return toCellTimeRange({ allDay: false, start, end });
}

const RECORDS: DatabaseRow[] = [
  ['Research interviews', allDay(-9, -3), 'Plan'],
  ['Write the brief', allDay(-4, 1), 'Plan'],
  ['Kickoff meeting', timed(0, 10, 11), 'Plan'],
  ['Design review', allDay(2, 6), 'Build'],
  ['Build the prototype', allDay(-2, 12), 'Build'],
  ['Usability test', allDay(8, 10), 'Build'],
  ['Launch', allDay(14, 14), 'Ship'],
  ['Write the announcement', allDay(11, 15), 'Ship'],
  ['Unscheduled follow-up', null, 'Ship'],
].map(([title, dates, stage], index) => ({
  rowId: `row-${index}`,
  cells: { name: title, dates, stage },
}));

function Fixture() {
  const [rows, setRows] = createSignal(params.has('empty') ? [] : RECORDS);
  const [view, setView] = createSignal<DatabaseViewState>({
    query: { filter: null, sort: [] },
    layout: {
      kind: 'timeline',
      range: 'dates',
      title: 'name',
      groupBy: params.has('grouped') ? 'stage' : null,
      barFields: [],
      colorBy: params.has('grouped') ? 'stage' : null,
    },
  });
  return (
    <div class="flex h-dvh flex-col bg-panel text-ink">
      <DatabaseTimelineView
        view={view()}
        rows={rows()}
        columns={COLUMNS}
        canEdit
        filtered={false}
        rowPending={() => false}
        onViewChange={(change) =>
          setView((current) => ({ ...current, ...change }))
        }
        onOpen={() => {}}
        onCreate={async ({ values }) => {
          setRows((current) => [
            ...current,
            { rowId: `row-${current.length}`, cells: { name: '', ...values } },
          ]);
          return true;
        }}
        onWrite={async (rowId, columnId, value) => {
          setRows((current) =>
            current.map((row) =>
              row.rowId === rowId
                ? { ...row, cells: { ...row.cells, [columnId]: value } }
                : row
            )
          );
          return true;
        }}
      />
    </div>
  );
}

const dark = params.get('theme') === 'dark';
document.documentElement.dataset.themeLight = String(!dark);
for (const [key, token] of Object.entries(
  themeCssVars(dark ? macroDarkTheme : macroLightTheme)
))
  document.documentElement.style.setProperty(key, token);
const root = document.getElementById('root');
if (root) render(() => <Fixture />, root);
