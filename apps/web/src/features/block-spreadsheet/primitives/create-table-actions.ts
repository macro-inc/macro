import { cellPlainText } from '@macro-inc/spreadsheet/cell-mentions';
import {
  type CellSelection,
  selectionBounds,
} from '@macro-inc/spreadsheet/grid-selection';
import { displayNumber } from '@macro-inc/spreadsheet/number-display';
import {
  currentRegion,
  keepsHiddenRow,
  nextTableName,
  replaceTable,
  resizeTable,
  type SheetTable,
  setTableTotalsRow,
  sheetTableLayouts,
  TABLE_TOTALS,
  TABLE_TOTALS_LABELS,
  type TableColumnFilter,
  type TableColumnType,
  type TableTotalsFunction,
  tableAt,
  tableBounds,
  tableColumnNames,
  tableDataRows,
  totalsFormula,
  totalsFunction,
} from '@macro-inc/spreadsheet/sheet-tables';
import {
  columnTypeMismatch,
  createTypedTable,
  columnChoices as listChoices,
  setTableColumnType,
} from '@macro-inc/spreadsheet/table-columns';
import {
  convertTableToRange,
  deleteTable,
  renameTable,
  type SheetChanges,
  workbookNames,
} from '@macro-inc/spreadsheet/table-edits';
import {
  filterTable,
  type TableCellText,
} from '@macro-inc/spreadsheet/table-filters';
import { groupTableRows } from '@macro-inc/spreadsheet/table-groups';
import { coloredTable } from '@macro-inc/spreadsheet/table-styles';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import type { CellCopy, SpreadsheetCalculation } from '../core/calculation';
import type { TableReferences } from '../core/formula-completion';
import { sortedRangeCopies } from '../core/sheet-operations';
import {
  formatCellAddress,
  type SpreadsheetCellEdits,
} from '../core/spreadsheet-document';
import type {
  TableDialogInput,
  TableDialogState,
  TableFilterChoice,
  TableGroupView,
  TableOption,
} from '../core/table-types';
import type { SpreadsheetStore } from './create-spreadsheet-store';

/** A new table on an empty cell: a header row and four blank rows. */
const BLANK_TABLE = { rows: 5, columns: 4 };

export function createTableActions(options: {
  store: SpreadsheetStore;
  canEdit: Accessor<boolean>;
  selection: Accessor<CellSelection>;
  /** The active sheet's calculated values. */
  values: Accessor<SpreadsheetCalculation>;
  calculating: Accessor<boolean>;
  copyCells: (copies: CellCopy[]) => Promise<SpreadsheetCellEdits>;
  setNotice: (message: string) => void;
}) {
  const { store } = options;
  const [dialog, setDialog] = createSignal<TableDialogState>();
  const [error, setError] = createSignal<string>();
  /** The table whose menu is open. */
  const [menuOpen, setMenuOpen] = createSignal<string>();
  const [groupView, setGroupView] = createSignal<TableGroupView>();
  let operation = 0;

  const tables = () => store.activeSheet().metadata?.tables;
  const activeTable = () => {
    const { anchor } = options.selection();
    return tableAt(tables(), anchor.row, anchor.column);
  };
  const tableNamed = (name: string) =>
    tables()?.find((table) => table.name === name);
  /** What a cell shows: its calculated value, or its text before that. */
  const display = (row: number, column: number) => {
    const address = formatCellAddress(row, column);
    return (
      options.values()[address]?.display ??
      cellPlainText(store.cells()[address]?.value ?? '').replace(/^'/, '')
    );
  };
  const read = (row: number, column: number): TableCellText => {
    const number =
      options.values()[formatCellAddress(row, column)]?.number ?? undefined;
    return { text: display(row, column), number };
  };
  const sheets = () =>
    store.workbook().map(({ id, name, cells, metadata }) => ({
      id,
      name,
      cells,
      metadata,
    }));

  function apply(change: () => SheetChanges) {
    if (!options.canEdit()) return false;
    try {
      store.editSheets(change());
      return true;
    } catch (failure) {
      options.setNotice(
        failure instanceof Error
          ? failure.message
          : 'Unable to change the table.'
      );
      return false;
    }
  }

  /** Change one table of the active sheet, keeping the sheet's other
   * metadata; `edits` go with it. */
  function updateTable(
    name: string,
    update: (table: SheetTable) => SheetTable,
    edits: SpreadsheetCellEdits = {}
  ) {
    const sheet = store.activeSheet();
    return apply(() => [
      {
        sheetId: sheet.id,
        edits,
        metadata: replaceTable(sheet.metadata ?? {}, name, update),
      },
    ]);
  }

  /**
   * Convert the selection to a table, as Google Sheets does: one cell
   * converts the block of filled cells around it, and an empty cell becomes
   * a blank table. Columns take the types their values suggest.
   */
  function convert() {
    if (!options.canEdit()) return;
    const active = activeTable();
    if (active) {
      setMenuOpen(active.name);
      return;
    }
    const sheet = store.activeSheet();
    const selected = selectionBounds(options.selection());
    const limits = { rows: store.rowCount(), columns: store.columnCount() };
    let bounds = selected;
    if (selected.top === selected.bottom && selected.left === selected.right) {
      bounds = currentRegion(sheet.cells, selected, limits);
      const blank = {
        ...selected,
        bottom: selected.top + BLANK_TABLE.rows - 1,
        right: selected.left + BLANK_TABLE.columns - 1,
      };
      if (
        bounds.top === bounds.bottom &&
        bounds.left === bounds.right &&
        !sheet.cells[formatCellAddress(bounds.top, bounds.left)]?.value &&
        blank.bottom < limits.rows &&
        blank.right < limits.columns &&
        !tables()?.some((table) => {
          const other = tableBounds(table);
          return (
            other.top <= blank.bottom &&
            other.bottom >= blank.top &&
            other.left <= blank.right &&
            other.right >= blank.left
          );
        })
      )
        bounds = blank;
    }
    const range = `${formatCellAddress(bounds.top, bounds.left)}:${formatCellAddress(bounds.bottom, bounds.right)}`;
    apply(() => {
      const change = createTypedTable({
        metadata: sheet.metadata,
        cells: sheet.cells,
        range,
        name: nextTableName(workbookNames(sheets())),
        rowCount: limits.rows,
        display: (address) => options.values()[address]?.display,
      });
      return [
        { sheetId: sheet.id, edits: change.edits, metadata: change.metadata },
      ];
    });
  }

  function openRename(name: string) {
    if (!options.canEdit() || !tableNamed(name)) return;
    setError(undefined);
    setDialog({ kind: 'rename', table: name, name });
  }

  function openRange(name: string) {
    const table = tableNamed(name);
    if (!options.canEdit() || !table) return;
    setError(undefined);
    setDialog({ kind: 'range', table: name, range: table.range });
  }

  function save(input: TableDialogInput) {
    const current = dialog();
    if (!current || !options.canEdit()) return;
    try {
      const sheet = store.activeSheet();
      if (current.kind === 'rename' && input.kind === 'rename')
        store.editSheets(
          renameTable(sheets(), sheet.id, current.table, input.name)
        );
      else if (current.kind === 'range' && input.kind === 'range') {
        const change = resizeTable({
          metadata: sheet.metadata,
          cells: sheet.cells,
          name: current.table,
          range: input.range,
          display: (address) => options.values()[address]?.display,
        });
        store.editSheets([
          { sheetId: sheet.id, edits: change.edits, metadata: change.metadata },
        ]);
      }
      setDialog(undefined);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Unable to save the table.'
      );
    }
  }

  function setColor(name: string, color: string) {
    updateTable(name, (table) => coloredTable(table, color));
  }

  function setOption(name: string, option: TableOption, on: boolean) {
    updateTable(name, (table) => {
      if (option === 'bandedRows') return { ...table, bandedRows: on };
      const { [option]: _previous, ...rest } = table;
      return on ? { ...rest, [option]: true } : rest;
    });
  }

  function setTotalsRow(name: string, totalsRow: boolean) {
    const sheet = store.activeSheet();
    apply(() => {
      const change = setTableTotalsRow({
        metadata: sheet.metadata,
        cells: sheet.cells,
        name,
        totalsRow,
        rowCount: store.rowCount(),
      });
      return [
        { sheetId: sheet.id, edits: change.edits, metadata: change.metadata },
      ];
    });
  }

  const convertToRange = (name: string) =>
    apply(() => convertTableToRange(sheets(), store.activeSheetId(), name));

  const removeTable = (name: string) =>
    apply(() => deleteTable(sheets(), store.activeSheetId(), name));

  /** A column's distinct shown values, numbers first, and which are shown. */
  function columnChoices(name: string, column: number): TableFilterChoice[] {
    const table = tableNamed(name);
    if (!table) return [];
    const { left } = tableBounds(table);
    const { first, last } = tableDataRows(table);
    const filter = table.filters?.[column - left];
    const shown =
      filter?.values && new Set(filter.values.map((v) => v.toLowerCase()));
    const values = new Map<string, string>();
    for (let row = first; row <= last; row++) {
      const text = display(row, column).trim();
      if (!values.has(text.toLowerCase())) values.set(text.toLowerCase(), text);
    }
    return [...values.values()]
      .sort((a, b) => {
        if (a === '' || b === '') return Number(a === '') - Number(b === '');
        return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
      })
      .map((value) => ({
        value,
        shown:
          !shown ||
          (value === '' ? !!filter?.blanks : shown.has(value.toLowerCase())),
      }));
  }

  /** A column's filter, by its column on the sheet. */
  const columnFilter = (name: string, column: number) => {
    const table = tableNamed(name);
    return table?.filters?.[column - tableBounds(table).left];
  };

  /** Set or, given undefined, clear a column's filter. */
  function filterColumn(
    name: string,
    column: number,
    filter: TableColumnFilter | undefined
  ) {
    const table = tableNamed(name);
    if (!table) return;
    const offset = String(column - tableBounds(table).left);
    const filters = { ...table.filters };
    if (filter) filters[offset] = filter;
    else delete filters[offset];
    setFilters(name, filters);
  }

  function setFilters(name: string, filters: SheetTable['filters']) {
    const sheet = store.activeSheet();
    apply(() => [
      {
        sheetId: sheet.id,
        edits: {},
        metadata: filterTable({
          metadata: sheet.metadata,
          name,
          filters,
          read,
        }),
      },
    ]);
  }

  /**
   * Sort a table's data rows by a column. Rows its filters hide stay hidden
   * and move with their values.
   */
  async function sortColumn(name: string, column: number, descending: boolean) {
    const table = tableNamed(name);
    if (!table || !options.canEdit()) return;
    if (options.calculating()) {
      options.setNotice('Wait for the sheet to finish calculating, then sort.');
      return;
    }
    const { left, right } = tableBounds(table);
    const { first, last } = tableDataRows(table);
    if (first >= last) return;
    const sheet = store.activeSheet();
    const revision = store.revision();
    const current = ++operation;
    const copies = sortedRangeCopies(
      sheet.cells,
      options.values(),
      {
        anchor: { row: first, column: left },
        focus: { row: last, column: right },
      },
      descending,
      column
    );
    const edits = await options.copyCells(copies);
    if (
      current !== operation ||
      revision !== store.revision() ||
      sheet.id !== store.activeSheetId() ||
      !options.canEdit()
    ) {
      options.setNotice(
        'The sheet changed while sorting. Sort the table again.'
      );
      return;
    }
    const metadata = store.activeSheet().metadata;
    const keeps = keepsHiddenRow(metadata, name);
    const hidden = new Set(metadata?.hiddenRows ?? []);
    const next = new Set([...hidden].filter(keeps));
    for (const copy of copies)
      if (
        copy.from.column === left &&
        hidden.has(copy.from.row) &&
        !keeps(copy.from.row)
      )
        next.add(copy.to.row);
    const { hiddenRows: _hidden, ...rest } = metadata ?? {};
    apply(() => [
      {
        sheetId: sheet.id,
        edits,
        metadata: next.size
          ? { ...rest, hiddenRows: [...next].sort((a, b) => a - b) }
          : rest,
      },
    ]);
  }

  const columnType = (name: string, column: number) => {
    const table = tableNamed(name);
    return table?.columnTypes?.[column - tableBounds(table).left];
  };

  function setColumnType(
    name: string,
    column: number,
    type: TableColumnType | undefined
  ) {
    const sheet = store.activeSheet();
    apply(() => {
      const change = setTableColumnType({
        metadata: sheet.metadata,
        cells: sheet.cells,
        name,
        column,
        type,
        display,
      });
      return [
        { sheetId: sheet.id, edits: change.edits, metadata: change.metadata },
      ];
    });
  }

  /** Each typed column's type and dropdown options, by sheet column. */
  const typedColumns = createMemo(() => {
    const validations = store.activeSheet().metadata?.validations;
    return (tables() ?? []).flatMap((table) => {
      const { left } = tableBounds(table);
      const data = tableDataRows(table);
      return Object.entries(table.columnTypes ?? {}).map(([offset, type]) => {
        const column = left + Number(offset);
        return {
          column,
          first: data.first,
          last: data.last,
          type,
          choices:
            type === 'dropdown'
              ? listChoices(validations, table, column)
              : undefined,
        };
      });
    });
  });

  /** Why a cell's value does not fit its table column's type. */
  function mismatch(row: number, column: number) {
    const typed = typedColumns().find(
      (item) => item.column === column && row >= item.first && row <= item.last
    );
    if (!typed) return;
    const address = formatCellAddress(row, column);
    return columnTypeMismatch(
      typed.type,
      store.cells()[address],
      options.values()[address],
      typed.choices
    );
  }

  /** The table whose total row holds a cell, and the cell's column name. */
  const totalAt = (row: number, column: number) => {
    const table = tableAt(tables(), row, column);
    if (!table?.totalsRow || row !== tableBounds(table).bottom) return;
    const names = tableColumnNames(table, store.cells());
    return { table, column: names[column - tableBounds(table).left] };
  };

  /** The aggregate a total row cell shows, such as `Sum`. */
  function totalLabel(row: number, column: number) {
    const total = totalAt(row, column);
    const value = store.cells()[formatCellAddress(row, column)]?.value;
    if (!total || !value?.startsWith('=')) return;
    const aggregate = totalsFunction(value, total.column, total.table.name);
    return aggregate && TABLE_TOTALS_LABELS[aggregate];
  }

  /** The aggregates the active total row cell offers. */
  const totalChoices = () => {
    const { anchor } = options.selection();
    return totalAt(anchor.row, anchor.column)
      ? ['None', ...TABLE_TOTALS.map((key) => TABLE_TOTALS_LABELS[key])]
      : undefined;
  };

  /** Whether `label` was chosen for the active total cell. Percentages show
   * as such; sums and the like take the column's number format. */
  function pickTotal(label: string) {
    const { anchor } = options.selection();
    const total = totalAt(anchor.row, anchor.column);
    if (!total || !options.canEdit()) return false;
    const aggregate: TableTotalsFunction | undefined = TABLE_TOTALS.find(
      (key) => TABLE_TOTALS_LABELS[key] === label
    );
    if (!aggregate && label !== 'None') return false;
    const above =
      store.cells()[
        formatCellAddress(tableDataRows(total.table).first, anchor.column)
      ];
    const format = aggregate?.startsWith('percent')
      ? { format: 'percent' as const, numberFormat: '', decimals: -1 }
      : aggregate &&
          ['sum', 'average', 'min', 'max', 'stdDev', 'var'].includes(aggregate)
        ? {
            format: above?.format ?? 'general',
            numberFormat: above?.numberFormat ?? '',
            decimals: above?.decimals ?? -1,
          }
        : { format: 'general' as const, numberFormat: '', decimals: -1 };
    store.setCells({
      [formatCellAddress(anchor.row, anchor.column)]: {
        value: aggregate ? totalsFormula(aggregate, total.column) : '',
        ...format,
      },
    });
    return true;
  }

  /** Open the group by view, summing the first number column, or counting
   * rows when the table has none. */
  function openGroupBy(name: string, column?: number) {
    const table = tableNamed(name);
    if (!table) return;
    const { left } = tableBounds(table);
    const grouped = column ?? left;
    const numeric = Object.entries(table.columnTypes ?? {})
      .filter(
        ([offset, type]) =>
          left + Number(offset) !== grouped &&
          (type === 'number' || type === 'currency' || type === 'percent')
      )
      .map(([offset]) => left + Number(offset))
      .sort((a, b) => a - b)[0];
    setGroupView({
      table: name,
      column: grouped,
      summaryColumn: numeric ?? grouped,
      summary: numeric === undefined ? 'count' : 'sum',
    });
  }

  /** The groups of the group by view: values with their rows' summaries. */
  const groups = createMemo(() => {
    const view = groupView();
    const table = view && tableNamed(view.table);
    if (!view || !table) return [];
    return groupTableRows({ table, column: view.column, read }).map(
      (group) => ({
        ...group,
        cells: group.rows.map((row) => read(row, view.summaryColumn)),
      })
    );
  });

  /** A summary shown in the summarized column's number format. */
  function formatSummary(value: number) {
    const view = groupView();
    const table = view && tableNamed(view.table);
    const cell =
      table &&
      store.cells()[
        formatCellAddress(tableDataRows(table).first, view.summaryColumn)
      ];
    return displayNumber(value, cell);
  }

  /** Filter the grouped column to one group's value, or show every row. */
  function showGroup(value: string | undefined) {
    const view = groupView();
    if (!view) return;
    filterColumn(
      view.table,
      view.column,
      value === undefined
        ? undefined
        : value
          ? { values: [value] }
          : { values: [], blanks: true }
    );
  }

  return {
    table: tableNamed,
    dialog,
    error,
    menuOpen,
    setMenuOpen,
    activeTable,
    convert,
    openRename,
    openRange,
    closeDialog: () => setDialog(undefined),
    save,
    setColor,
    setOption,
    setTotalsRow,
    convertToRange,
    deleteTable: removeTable,
    columnChoices,
    columnFilter,
    filterColumn,
    clearFilters: (name: string) => setFilters(name, {}),
    sortColumn,
    columnType,
    setColumnType,
    mismatch,
    totalLabel,
    totalChoices,
    pickTotal,
    groupView,
    openGroupBy,
    setGroupView: (view: Partial<Omit<TableGroupView, 'table'>>) => {
      const current = groupView();
      const next = current && { ...current, ...view };
      if (
        next &&
        (next.column !== current.column ||
          next.summaryColumn !== current.summaryColumn ||
          next.summary !== current.summary)
      )
        setGroupView(next);
    },
    closeGroupBy: () => setGroupView(undefined),
    groups,
    formatSummary,
    showGroup,
    columnNames: (name: string) => {
      const table = tableNamed(name);
      return table ? tableColumnNames(table, store.cells()) : [];
    },
    /** Every table's name and columns, for formula completion. */
    references: (): TableReferences => {
      const tables = store
        .workbook()
        .flatMap(sheetTableLayouts)
        .map(({ name, columns }) => ({ name, columns }));
      const own = activeTable()?.name.toLowerCase();
      return {
        tables,
        own: tables.find((table) => table.name.toLowerCase() === own),
      };
    },
  };
}

export type TableActions = ReturnType<typeof createTableActions>;
