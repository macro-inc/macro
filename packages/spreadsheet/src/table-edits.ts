import { cellPlainText } from './cell-mentions';
import { replaceValidations } from './data-validation';
import {
  checkTableName,
  expandTables,
  findTable,
  keepsHiddenRow,
  replaceTable,
  type SheetTable,
  sheetTableLayouts,
  tableBounds,
  tableColumnNames,
  withEdits,
} from './sheet-tables';
import {
  formatCellAddress,
  parseCellAddress,
  type SpreadsheetCellEdits,
  type SpreadsheetCells,
} from './spreadsheet-document';
import {
  renameColumnReferences,
  renameTableReferences,
  resolveStructuredReferences,
} from './structured-references';
import { calculatedColumnEdits, newTableRow } from './table-columns';
import { tableLookEdits } from './table-styles';
import type { WorkbookSheetMetadata } from './workbook-metadata';

/** A sheet as the workbook-wide table operations read it. */
export type TableSheet = {
  id: string;
  name: string;
  cells: SpreadsheetCells;
  metadata?: WorkbookSheetMetadata;
};

/** Cell and metadata changes for several sheets, written as one change. */
export type SheetChanges = {
  sheetId: string;
  edits: SpreadsheetCellEdits;
  metadata?: WorkbookSheetMetadata;
}[];

/** Names tables and defined names already use in the workbook. */
export function workbookNames(sheets: TableSheet[]): string[] {
  return sheets.flatMap((sheet) => [
    ...(sheet.metadata?.tables ?? []).map((table) => table.name),
    ...(sheet.metadata?.definedNames ?? []).map((entry) => entry.name),
  ]);
}

/** Each sheet's formulas `rewrite` changes, as edits by sheet id. Formulas
 * that cannot refer to a table, without brackets or any of `tables`' names,
 * are skipped. */
function rewriteFormulas(
  sheets: TableSheet[],
  tables: string[],
  rewrite: (formula: string, sheet: TableSheet, address: string) => string
) {
  const names = tables.map((name) => name.toLowerCase());
  const changes = new Map<string, SpreadsheetCellEdits>();
  for (const sheet of sheets) {
    const edits: SpreadsheetCellEdits = {};
    for (const [address, cell] of Object.entries(sheet.cells)) {
      if (!cell.value.startsWith('=') || cell.format === 'text') continue;
      if (!cell.value.includes('[')) {
        const lower = cell.value.toLowerCase();
        if (!names.some((name) => lower.includes(name))) continue;
      }
      const value = rewrite(cell.value, sheet, address);
      if (value !== cell.value) edits[address] = { value };
    }
    changes.set(sheet.id, edits);
  }
  return changes;
}

/** Sheet changes from formula rewrites and one sheet's own change. */
function sheetChanges(
  sheets: TableSheet[],
  formulas: Map<string, SpreadsheetCellEdits>,
  own: {
    sheetId: string;
    edits?: SpreadsheetCellEdits;
    metadata?: WorkbookSheetMetadata;
  }
): SheetChanges {
  return sheets.flatMap((item) => {
    const edits = {
      ...formulas.get(item.id),
      ...(item.id === own.sheetId && own.edits),
    };
    const metadata = item.id === own.sheetId ? own.metadata : undefined;
    return Object.keys(edits).length || metadata
      ? [{ sheetId: item.id, edits, ...(metadata && { metadata }) }]
      : [];
  });
}

/** Rename a table and every formula reference to it. Spaces in the new name
 * become underscores, as Google Sheets writes them in formulas. */
export function renameTable(
  sheets: TableSheet[],
  sheetId: string,
  from: string,
  to: string
): SheetChanges {
  const sheet = sheets.find((item) => item.id === sheetId);
  findTable(sheet?.metadata, from);
  const name = checkTableName(
    to,
    workbookNames(sheets).filter((existing) => existing !== from)
  );
  if (name === from) return [];
  const formulas = rewriteFormulas(sheets, [from], (formula) =>
    renameTableReferences(formula, from, name)
  );
  return sheetChanges(sheets, formulas, {
    sheetId,
    metadata: replaceTable(sheet?.metadata ?? {}, from, (table) => ({
      ...table,
      name,
    })),
  });
}

/** A table's removal: formulas that refer to it get the cell ranges it
 * covers, and rows its filters hid are shown. */
function removeTable(
  sheets: TableSheet[],
  sheetId: string,
  name: string
): {
  table: SheetTable;
  formulas: Map<string, SpreadsheetCellEdits>;
  metadata: WorkbookSheetMetadata;
} {
  const sheet = sheets.find((item) => item.id === sheetId);
  const table = findTable(sheet?.metadata, name);
  const layouts = sheets.flatMap(sheetTableLayouts);
  const formulas = rewriteFormulas(
    sheets,
    [name],
    (formula, current, address) => {
      const position = parseCellAddress(address)!;
      return (
        resolveStructuredReferences(
          formula,
          layouts,
          current.name,
          position.row,
          position.column,
          { resolves: (layout) => layout.name === name }
        ) ?? formula
      );
    }
  );
  const keeps = keepsHiddenRow(sheet?.metadata, name);
  const metadata = replaceTable(sheet?.metadata ?? {}, name, () => undefined);
  if (table.filters && metadata.hiddenRows) {
    const hiddenRows = metadata.hiddenRows.filter(keeps);
    if (hiddenRows.length) metadata.hiddenRows = hiddenRows;
    else delete metadata.hiddenRows;
  }
  return { table, formulas, metadata };
}

/**
 * Turn a table back into ordinary cells that keep its look: its header and
 * band colors become the cells' own formatting.
 */
export function convertTableToRange(
  sheets: TableSheet[],
  sheetId: string,
  name: string
): SheetChanges {
  const { table, formulas, metadata } = removeTable(sheets, sheetId, name);
  const cells = sheets.find((item) => item.id === sheetId)?.cells ?? {};
  const look = tableLookEdits(table, cells);
  const own = formulas.get(sheetId) ?? {};
  for (const [address, edit] of Object.entries(look))
    own[address] = { ...edit, ...own[address] };
  formulas.set(sheetId, own);
  return sheetChanges(sheets, formulas, { sheetId, metadata });
}

/** Delete a table and its cells, as Google Sheets does; formulas that
 * referred to it keep the emptied cell ranges. */
export function deleteTable(
  sheets: TableSheet[],
  sheetId: string,
  name: string
): SheetChanges {
  const { table, formulas, metadata } = removeTable(sheets, sheetId, name);
  const cells = sheets.find((item) => item.id === sheetId)?.cells ?? {};
  const bounds = tableBounds(table);
  const edits: SpreadsheetCellEdits = { ...formulas.get(sheetId) };
  for (let row = bounds.top; row <= bounds.bottom; row++)
    for (let column = bounds.left; column <= bounds.right; column++) {
      const address = formatCellAddress(row, column);
      if (cells[address]) edits[address] = null;
      else delete edits[address];
    }
  formulas.delete(sheetId);
  const validations = metadata.validations?.length
    ? replaceValidations(metadata.validations, table.range)
    : undefined;
  const { validations: _validations, ...rest } = metadata;
  return sheetChanges(sheets, formulas, {
    sheetId,
    edits,
    metadata: validations?.length ? { ...rest, validations } : rest,
  });
}

/** A header cell's text, as its column name reads it. */
function headerText(cells: SpreadsheetCells, address: string) {
  const cell = cells[address];
  return cell && !(cell.value.startsWith('=') && cell.format !== 'text')
    ? cellPlainText(cell.value).replace(/^'/, '')
    : undefined;
}

/**
 * What writing `edits` to a sheet does to its tables, as one change across
 * the workbook, or undefined when it touches none:
 * - a value typed below or right of a table extends it, a new row taking the
 *   formats, lists and calculated column formulas of the row above;
 * - a formula referring to its own row fills its empty table column;
 * - an edited header renames its column, writing the name a blank or
 *   repeated header takes, and formulas refer to the new name.
 */
export function tableEditChanges(
  sheets: TableSheet[],
  sheetId: string,
  edits: SpreadsheetCellEdits
): SheetChanges | undefined {
  const sheet = sheets.find((item) => item.id === sheetId);
  const tables = sheet?.metadata?.tables;
  if (!sheet?.metadata || !tables?.length) return;
  let metadata = sheet.metadata;
  let metadataChanged = false;
  let own: SpreadsheetCellEdits = { ...edits };
  const grown = expandTables({ metadata, cells: sheet.cells, edits });
  if (grown) {
    metadata = grown.metadata;
    metadataChanged = true;
    own = { ...own, ...grown.edits };
    const table = metadata.tables?.find((item) => {
      const before = tables.find((old) => old.name === item.name);
      return before && tableBounds(before).bottom !== tableBounds(item).bottom;
    });
    if (table) {
      const added = newTableRow({
        metadata,
        table,
        cells: sheet.cells,
        row: tableBounds(table).bottom,
        edits: own,
      });
      own = { ...own, ...added.edits };
      if (added.validations)
        metadata = { ...metadata, validations: added.validations };
    }
  }
  const calculated = calculatedColumnEdits(metadata.tables, sheet.cells, edits);
  if (calculated) own = { ...calculated, ...own };
  const after = withEdits(sheet.cells, own);
  const renames: { table: string; from: string; to: string }[] = [];
  let headersNamed = false;
  for (const table of metadata.tables ?? []) {
    const bounds = tableBounds(table);
    const previous = tables.find((item) => item.name === table.name) ?? table;
    const old = tableColumnNames(previous, sheet.cells);
    const headers = Object.keys(own).filter((address) => {
      const position = parseCellAddress(address);
      return (
        position?.row === bounds.top &&
        position.column >= bounds.left &&
        position.column <= bounds.right
      );
    });
    if (!headers.length) continue;
    const names = tableColumnNames(table, after);
    for (const address of headers) {
      const offset = parseCellAddress(address)!.column - bounds.left;
      const name = names[offset];
      if (headerText(after, address) !== name) {
        own[address] = {
          ...own[address],
          value: name.startsWith('=') ? `'${name}` : name,
        };
        headersNamed = true;
      }
      if (offset < old.length && old[offset] !== name)
        renames.push({ table: table.name, from: old[offset], to: name });
    }
  }
  if (!metadataChanged && !calculated && !renames.length && !headersNamed)
    return;
  const workbook = sheets.map((item) =>
    item.id === sheetId
      ? { ...item, cells: withEdits(item.cells, own), metadata }
      : item
  );
  const layouts = workbook.flatMap(sheetTableLayouts);
  // Placeholders first, so swapped names do not rename each other twice.
  const steps = [
    ...renames.map((rename, index) => ({
      ...rename,
      to: `__macro_column_${index}__`,
    })),
    ...renames.map((rename, index) => ({
      ...rename,
      from: `__macro_column_${index}__`,
    })),
  ];
  const formulas = renames.length
    ? rewriteFormulas(workbook, [], (formula, current, address) => {
        const position = parseCellAddress(address)!;
        return steps.reduce(
          (text, step) =>
            renameColumnReferences(
              text,
              layouts,
              current.name,
              position.row,
              position.column,
              step
            ),
          formula
        );
      })
    : new Map<string, SpreadsheetCellEdits>();
  const rewritten = formulas.get(sheetId) ?? {};
  for (const [address, edit] of Object.entries(rewritten))
    own[address] = { ...own[address], ...edit };
  formulas.delete(sheetId);
  return sheetChanges(workbook, formulas, {
    sheetId,
    edits: own,
    ...(metadataChanged && { metadata }),
  });
}
