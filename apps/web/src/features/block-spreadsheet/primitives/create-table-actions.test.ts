import { LoroDoc } from 'loro-crdt';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import type { CellCopy } from '../core/calculation';
import type { CellSelection } from '../core/grid-selection';
import {
  formatCellAddress,
  type SpreadsheetCellEdits,
  writeSpreadsheetCells,
} from '../core/spreadsheet-document';
import { createSpreadsheetStore } from './create-spreadsheet-store';
import { createTableActions } from './create-table-actions';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function setup() {
  const doc = new LoroDoc();
  writeSpreadsheetCells(doc, {
    A1: { value: 'Region' },
    B1: { value: 'Amount' },
    A2: { value: 'West' },
    B2: { value: '20' },
    A3: { value: 'East' },
    B3: { value: '10' },
    A4: { value: 'North' },
    B4: { value: '30' },
    D1: { value: '=SUM(Table1[Amount])' },
  });
  const notices: string[] = [];
  const result = createRoot((dispose) => {
    cleanups.push(() => {
      dispose();
      doc.free();
    });
    const store = createSpreadsheetStore({
      canEdit: () => true,
      source: {
        doc: () => doc,
        ready: () => true,
        error: () => undefined,
        status: () => 'local',
        peers: () => [],
        setSelection: () => {},
      },
    });
    const [selection, setSelection] = createSignal<CellSelection>({
      anchor: { row: 1, column: 0 },
      focus: { row: 1, column: 0 },
    });
    // Copies move cells as they are, which is what sorting plain values does.
    const copyCells = async (copies: CellCopy[]) => {
      const edits: SpreadsheetCellEdits = {};
      for (const { to, cell } of copies)
        edits[formatCellAddress(to.row, to.column)] = cell;
      return edits;
    };
    const actions = createTableActions({
      store,
      canEdit: () => true,
      selection,
      values: () => ({}),
      calculating: () => false,
      copyCells,
      setNotice: (message) => notices.push(message),
    });
    return { store, actions, setSelection };
  });
  await Promise.resolve();
  return { ...result, notices };
}

const select = (
  setSelection: (selection: CellSelection) => void,
  row: number,
  column: number
) => setSelection({ anchor: { row, column }, focus: { row, column } });

describe('table actions', () => {
  it('converts the block around the active cell and types its columns', async () => {
    const { store, actions } = await setup();
    actions.convert();
    expect(store.activeSheet().metadata?.tables).toEqual([
      {
        id: expect.any(String),
        name: 'Table1',
        range: 'A1:B4',
        totalsRow: false,
        bandedRows: true,
        style: 'TableStyleMedium2',
        columnTypes: { 0: 'text', 1: 'number' },
      },
    ]);
    // Converting inside a table opens its menu instead.
    actions.convert();
    expect(actions.menuOpen()).toBe('Table1');
    expect(store.activeSheet().metadata?.tables).toHaveLength(1);
  });

  it('makes an empty cell a blank table', async () => {
    const { store, actions, setSelection } = await setup();
    select(setSelection, 9, 4);
    actions.convert();
    expect(store.activeSheet().metadata?.tables?.[0]).toMatchObject({
      name: 'Table1',
      range: 'E10:H14',
    });
    expect(store.cells().E10.value).toBe('Column1');
    expect(store.cells().H10.value).toBe('Column4');
  });

  it('filters by values and conditions, sorts, and keeps filtered rows hidden', async () => {
    const { store, actions } = await setup();
    actions.convert();
    actions.setTotalsRow('Table1', true);
    expect(store.cells().B5.value).toBe('=SUBTOTAL(109,[Amount])');

    actions.filterColumn('Table1', 0, { values: ['East', 'West'] });
    expect(store.activeSheet().metadata?.hiddenRows).toEqual([3]);
    expect(actions.columnChoices('Table1', 0)).toEqual([
      { value: 'East', shown: true },
      { value: 'North', shown: false },
      { value: 'West', shown: true },
    ]);

    await actions.sortColumn('Table1', 1, true);
    // North (30) sorts first and stays hidden; the total row stays put.
    expect(store.cells().A2.value).toBe('North');
    expect(store.cells().A4.value).toBe('East');
    expect(store.cells().B5.value).toBe('=SUBTOTAL(109,[Amount])');
    expect(store.activeSheet().metadata?.hiddenRows).toEqual([1]);

    actions.filterColumn('Table1', 1, {
      condition: { operator: 'greaterThan', value: '15' },
    });
    expect(store.activeSheet().metadata?.hiddenRows).toEqual([1, 3]);
    actions.clearFilters('Table1');
    expect(store.activeSheet().metadata?.hiddenRows).toBeUndefined();
  });

  it('offers footer aggregates and labels the chosen one', async () => {
    const { store, actions, setSelection } = await setup();
    actions.convert();
    actions.setTotalsRow('Table1', true);
    select(setSelection, 4, 1);
    expect(actions.totalChoices()).toContain('Percent filled');
    expect(actions.pickTotal('Average')).toBe(true);
    expect(store.cells().B5.value).toBe('=SUBTOTAL(101,[Amount])');
    expect(actions.totalLabel(4, 1)).toBe('Average');
    expect(actions.pickTotal('Unique')).toBe(true);
    expect(store.cells().B5.value).toBe(
      '=SUMPRODUCT(([Amount]<>"")/COUNTIF([Amount],[Amount]&""))'
    );
    expect(actions.pickTotal('Percent empty')).toBe(true);
    expect(store.cells().B5).toMatchObject({
      value: '=COUNTBLANK([Amount])/ROWS([Amount])',
      format: 'percent',
    });
    select(setSelection, 2, 1);
    expect(actions.totalChoices()).toBeUndefined();
  });

  it('renames, recolors and restyles a table', async () => {
    const { store, actions } = await setup();
    actions.convert();
    actions.openRename('Table1');
    expect(actions.dialog()).toEqual({
      kind: 'rename',
      table: 'Table1',
      name: 'Table1',
    });
    actions.save({ kind: 'rename', name: 'Q1 sales' });
    expect(actions.dialog()).toBeUndefined();
    expect(store.cells().D1.value).toBe('=SUM(Q1_sales[Amount])');
    actions.setColor('Q1_sales', '#d93025');
    actions.setOption('Q1_sales', 'bandedRows', false);
    actions.setOption('Q1_sales', 'firstColumn', true);
    expect(store.activeSheet().metadata?.tables?.[0]).toMatchObject({
      name: 'Q1_sales',
      style: 'TableStyleMedium3',
      color: '#d93025',
      bandedRows: false,
      firstColumn: true,
    });
    store.undo();
    expect(store.activeSheet().metadata?.tables?.[0].firstColumn).toBe(
      undefined
    );
  });

  it('explains names that cannot be used and keeps the dialog open', async () => {
    const { actions } = await setup();
    actions.convert();
    actions.openRename('Table1');
    actions.save({ kind: 'rename', name: 'A1' });
    expect(actions.error()).toContain('not a valid table name');
    expect(actions.dialog()).toMatchObject({ kind: 'rename' });
  });

  it('adjusts the range, keeping filters with their columns', async () => {
    const { store, actions } = await setup();
    actions.convert();
    actions.filterColumn('Table1', 1, { values: ['10'] });
    actions.openRange('Table1');
    actions.save({ kind: 'range', range: 'A1:C4' });
    expect(store.activeSheet().metadata?.tables?.[0]).toMatchObject({
      range: 'A1:C4',
      filters: { 1: { values: ['10'] } },
    });
    expect(store.cells().C1.value).toBe('Column3');
  });

  it('types a column, flags values that do not fit, and turns it into a dropdown', async () => {
    const { store, actions } = await setup();
    actions.convert();
    actions.setColumnType('Table1', 1, 'currency');
    expect(store.cells().B2.format).toBe('currency');
    expect(actions.mismatch(1, 1)).toBeUndefined();
    store.setCells({ B3: { value: 'n/a' } });
    expect(actions.mismatch(2, 1)).toBe('Expected a number');
    actions.setColumnType('Table1', 0, 'dropdown');
    expect(store.activeSheet().metadata?.validations).toEqual([
      expect.objectContaining({
        range: 'A2:A4',
        type: 'list',
        formulas: ['"West,East,North"'],
      }),
    ]);
    actions.setColumnType('Table1', 0, undefined);
    expect(store.activeSheet().metadata?.validations).toBeUndefined();
  });

  it('groups rows by a column and filters to a group', async () => {
    const { store, actions } = await setup();
    store.setCells({ A3: { value: 'West' } });
    actions.convert();
    actions.openGroupBy('Table1', 0);
    expect(actions.groupView()).toEqual({
      table: 'Table1',
      column: 0,
      summaryColumn: 1,
      summary: 'sum',
    });
    expect(
      actions.groups().map((group) => [group.value, group.rows.length])
    ).toEqual([
      ['North', 1],
      ['West', 2],
    ]);
    // An unchanged view is kept, so selects re-sending their value settle.
    const view = actions.groupView();
    actions.setGroupView({ column: 0, summary: 'sum' });
    expect(actions.groupView()).toBe(view);
    store.setCells({ B2: { format: 'currency' } });
    expect(actions.formatSummary(1234.5)).toBe('$1,234.50');
    actions.showGroup('West');
    expect(store.activeSheet().metadata?.hiddenRows).toEqual([3]);
    actions.showGroup(undefined);
    expect(store.activeSheet().metadata?.hiddenRows).toBeUndefined();
  });

  it('converts to a range that keeps the look, or deletes the table and its cells', async () => {
    const { store, actions } = await setup();
    actions.convert();
    actions.convertToRange('Table1');
    expect(store.activeSheet().metadata?.tables).toBeUndefined();
    expect(store.cells().D1.value).toBe('=SUM($B$2:$B$4)');
    expect(store.cells().A1).toMatchObject({
      fillColor: '#4472c4',
      textColor: '#ffffff',
      bold: true,
    });
    store.undo();
    actions.deleteTable('Table1');
    expect(store.activeSheet().metadata?.tables).toBeUndefined();
    expect(store.cells().A2).toBeUndefined();
    expect(store.cells().D1.value).toBe('=SUM($B$2:$B$4)');
  });
});
