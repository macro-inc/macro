import { getTokens, Model } from '@ironcalc/wasm';
import {
  formatCellAddress,
  parseCellAddress,
  SPREADSHEET_MAX_COLUMNS,
  SPREADSHEET_MAX_ROWS,
  type SpreadsheetCells,
} from './spreadsheet-document';
import type { SpreadsheetWorkbookSheet } from './workbook-document';
import type { WorkbookSheetMetadata } from './workbook-metadata';

export type AxisChange = {
  sheetId: string;
  axis: 'row' | 'column';
  index: number;
  count: number;
  kind: 'insert' | 'delete';
};

/** Trim partially deleted ranges before IronCalc turns a deleted endpoint into #REF. */
function prepareDeletion(
  formula: string,
  currentSheet: string,
  targetSheet: string,
  change: AxisChange
): string {
  if (change.kind !== 'delete') return formula;
  const characters = Array.from(formula);
  for (const { token, start, end } of getTokens(formula).reverse()) {
    if (typeof token !== 'object' || !('Range' in token)) continue;
    const range = token.Range;
    if (
      (range.sheet ?? currentSheet).toLowerCase() !== targetSheet.toLowerCase()
    )
      continue;
    const left = { ...range.left },
      right = { ...range.right };
    const referenceText = characters
      .slice(start, end)
      .join('')
      .split('!')
      .at(-1)!;
    const wholeRows = /^\$?\d+:\$?\d+$/.test(referenceText);
    const wholeColumns = /^\$?[A-Z]+:\$?[A-Z]+$/i.test(referenceText);
    if (
      (wholeRows && change.axis === 'column') ||
      (wholeColumns && change.axis === 'row')
    )
      continue;
    const low = Math.min(left[change.axis], right[change.axis]);
    const high = Math.max(left[change.axis], right[change.axis]);
    const first = change.index + 1,
      last = change.index + change.count;
    if (low >= first && high <= last) continue;
    let changed = false;
    for (const reference of [left, right]) {
      if (reference[change.axis] >= first && reference[change.axis] <= last) {
        reference[change.axis] =
          reference[change.axis] === low ? last + 1 : first - 1;
        changed = true;
      }
    }
    if (!changed) continue;
    const address = (ref: typeof left) => {
      let column = '';
      for (
        let index = ref.column;
        index > 0;
        index = Math.floor((index - 1) / 26)
      ) {
        column = String.fromCharCode(65 + ((index - 1) % 26)) + column;
      }
      if (wholeRows) return `${ref.absolute_row ? '$' : ''}${ref.row}`;
      if (wholeColumns) return `${ref.absolute_column ? '$' : ''}${column}`;
      const cell = `${column}${ref.row}`;
      return cell.replace(
        /^([A-Z]+)(\d+)$/,
        (_, column: string, row: string) =>
          `${ref.absolute_column ? '$' : ''}${column}${ref.absolute_row ? '$' : ''}${row}`
      );
    };
    const prefix = range.sheet ? `'${range.sheet.replaceAll("'", "''")}'!` : '';
    characters.splice(
      start,
      end - start,
      `${prefix}${address(left)}:${address(right)}`
    );
  }
  return characters.join('');
}

/**
 * Formulas kept outside cells, in a stable order: name definitions, then the
 * formulas and threshold values of conditional formats and data validation.
 */
function sheetFormulas(metadata: WorkbookSheetMetadata | undefined) {
  const formulas = (metadata?.definedNames ?? []).map((name) => name.formula);
  for (const rule of [
    ...(metadata?.conditionalFormats ?? []),
    ...(metadata?.validations ?? []),
  ]) {
    formulas.push(...(rule.formulas ?? []));
    if ('thresholds' in rule)
      for (const threshold of rule.thresholds ?? [])
        if (threshold.value !== undefined) formulas.push(threshold.value);
  }
  return formulas;
}

/** Metadata with its outside-cell formulas replaced, in `sheetFormulas` order. */
function withSheetFormulas(
  metadata: WorkbookSheetMetadata,
  formulas: string[]
): WorkbookSheetMetadata {
  let next = 0;
  const take = () => formulas[next++];
  const result = { ...metadata };
  if (metadata.definedNames)
    result.definedNames = metadata.definedNames.map((entry) => ({
      ...entry,
      formula: take(),
    }));
  if (metadata.conditionalFormats)
    result.conditionalFormats = metadata.conditionalFormats.map((rule) => ({
      ...rule,
      ...(rule.formulas && { formulas: rule.formulas.map(take) }),
      ...(rule.thresholds && {
        thresholds: rule.thresholds.map((threshold) =>
          threshold.value === undefined
            ? threshold
            : { ...threshold, value: take() }
        ),
      }),
    }));
  if (metadata.validations)
    result.validations = metadata.validations.map((rule) => ({
      ...rule,
      ...(rule.formulas && { formulas: rule.formulas.map(take) }),
    }));
  return result;
}

/** Keep cell identity, styles and all sheet references together during a structural edit. */
export function changeWorkbookAxis(
  sheets: SpreadsheetWorkbookSheet[],
  change: AxisChange
): SpreadsheetWorkbookSheet[] {
  const target = sheets.findIndex((sheet) => sheet.id === change.sheetId);
  const limit =
    change.axis === 'row' ? SPREADSHEET_MAX_ROWS : SPREADSHEET_MAX_COLUMNS;
  // Name definitions are moved through out-of-grid formulas below the last
  // row, in a column that a column deletion cannot remove.
  const helperColumn =
    change.axis === 'column' && change.kind === 'delete' && change.index === 0
      ? change.count
      : 0;
  if (
    target < 0 ||
    !Number.isInteger(change.index) ||
    !Number.isInteger(change.count) ||
    change.index < 0 ||
    change.count < 1 ||
    change.index + change.count > limit
  )
    throw new Error('Invalid row or column selection.');
  const move = (index: number): number | undefined => {
    if (index < change.index) return index;
    if (change.kind === 'insert') return index + change.count;
    return index < change.index + change.count
      ? undefined
      : index - change.count;
  };
  const movedRecord = (record: Record<number, number> | undefined) =>
    Object.fromEntries(
      Object.entries(record ?? {}).flatMap(([key, value]) => {
        const next = move(Number(key));
        return next === undefined || next >= limit ? [] : [[next, value]];
      })
    );
  const range = (value: string): string | undefined => {
    const [start, end = start] = value.split(':').map(parseCellAddress);
    if (!start || !end) throw new Error('Invalid sheet layout range.');
    const first = start[change.axis];
    const last = end[change.axis];
    if (
      change.kind === 'delete' &&
      first >= change.index &&
      last < change.index + change.count
    )
      return;
    start[change.axis] = move(first) ?? change.index;
    end[change.axis] = move(last) ?? change.index - 1;
    if (end[change.axis] >= limit)
      throw new Error(
        'This change would move a formatted range outside the supported sheet size.'
      );
    return `${formatCellAddress(start.row, start.column)}:${formatCellAddress(end.row, end.column)}`;
  };
  // Rule ranges are lists of cells and ranges; unlike formatted ranges they
  // are clipped at the sheet's edge rather than blocking an insertion.
  const ruleRange = (sqref: string): string | undefined => {
    const parts = sqref.split(/\s+/).flatMap((part) => {
      const [start, end = start] = part.split(':').map(parseCellAddress);
      if (!start || !end) return [];
      const first = move(start[change.axis]);
      const last = move(end[change.axis]);
      // A deletion removes the part only when it covers all of it.
      if (first === undefined && last === undefined) return [];
      start[change.axis] = first ?? change.index;
      end[change.axis] = Math.min(limit - 1, last ?? change.index - 1);
      if (start[change.axis] > end[change.axis]) return [];
      const from = formatCellAddress(start.row, start.column);
      const to = formatCellAddress(end.row, end.column);
      return [from === to ? from : `${from}:${to}`];
    });
    return parts.length ? parts.join(' ') : undefined;
  };
  const model = new Model('Sheet structure', 'en', 'UTC', 'en');
  try {
    model.pauseEvaluation();
    sheets.forEach((_, index) => {
      if (index) model.newSheet();
      model.renameSheet(index, `__macro_structure_${index}`);
    });
    sheets.forEach((sheet, index) => model.renameSheet(index, sheet.name));
    for (const [index, sheet] of sheets.entries()) {
      // A rule's formulas are relative to its first cell; references in an
      // out-of-grid cell move the same way.
      for (const [slot, formula] of sheetFormulas(sheet.metadata).entries())
        model.setUserInput(
          index,
          SPREADSHEET_MAX_ROWS + 1 + slot,
          helperColumn + 1,
          prepareDeletion(
            `=${formula.replace(/^=/, '')}`,
            sheet.name,
            sheets[target].name,
            change
          )
        );
      for (const name of sheet.metadata?.definedNames ?? []) {
        if (
          /^[=]?(?:[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|TRUE|FALSE|"(?:[^"\r\n]|"")*")$/i.test(
            name.formula
          )
        )
          continue;
        try {
          model.newDefinedName(
            name.name,
            name.local ? index : undefined,
            name.formula.replace(/^=/, '')
          );
        } catch {
          throw new Error(
            `Cannot move rows or columns while the named expression “${name.name}” uses an unsupported reference. No cells were changed.`
          );
        }
      }
      for (const [address, cell] of Object.entries(sheet.cells)) {
        const position = parseCellAddress(address)!;
        if (cell.value.startsWith('=') && cell.format !== 'text')
          model.setUserInput(
            index,
            position.row + 1,
            position.column + 1,
            prepareDeletion(cell.value, sheet.name, sheets[target].name, change)
          );
      }
    }
    if (change.axis === 'row') {
      if (change.kind === 'insert')
        model.insertRows(target, change.index + 1, change.count);
      else model.deleteRows(target, change.index + 1, change.count);
    } else if (change.kind === 'insert')
      model.insertColumns(target, change.index + 1, change.count);
    else model.deleteColumns(target, change.index + 1, change.count);
    return sheets.map((sheet, index) => {
      const cells: SpreadsheetCells = {};
      for (const [address, cell] of Object.entries(sheet.cells)) {
        const position = parseCellAddress(address)!;
        if (index === target) {
          const next = move(position[change.axis]);
          if (next === undefined) continue;
          if (next >= limit)
            throw new Error(
              `This change would push cells past ${limit} ${change.axis}s. Clear the trailing cells first.`
            );
          position[change.axis] = next;
        }
        cells[formatCellAddress(position.row, position.column)] = {
          ...cell,
          value:
            cell.value.startsWith('=') && cell.format !== 'text'
              ? model.getCellContent(
                  index,
                  position.row + 1,
                  position.column + 1
                )
              : cell.value,
        };
      }
      // IronCalc moves formula references but not its named-range definitions.
      // Read each definition from an out-of-grid formula after the same move.
      const metadata = withSheetFormulas(
        { ...sheet.metadata },
        sheetFormulas(sheet.metadata).map((_, slot) => {
          let row = SPREADSHEET_MAX_ROWS + slot;
          let column = helperColumn;
          if (index === target) {
            if (change.axis === 'row') row = move(row)!;
            else column = move(column)!;
          }
          return model
            .getCellContent(index, row + 1, column + 1)
            .replace(/^=/, '');
        })
      );
      let layout = sheet.layout;
      if (index === target) {
        if (metadata.merges)
          metadata.merges = metadata.merges.flatMap((value) => {
            const next = range(value);
            return next ? [next] : [];
          });
        if (metadata.autoFilter)
          metadata.autoFilter = range(metadata.autoFilter);
        if (metadata.notes)
          metadata.notes = Object.fromEntries(
            Object.entries(metadata.notes).flatMap(([address, note]) => {
              const position = parseCellAddress(address)!;
              const next = move(position[change.axis]);
              if (next === undefined || next >= limit) return [];
              position[change.axis] = next;
              return [[formatCellAddress(position.row, position.column), note]];
            })
          );
        if (metadata.conditionalFormats)
          metadata.conditionalFormats = metadata.conditionalFormats.flatMap(
            (rule) => {
              const next = ruleRange(rule.range);
              return next ? [{ ...rule, range: next }] : [];
            }
          );
        if (metadata.validations)
          metadata.validations = metadata.validations.flatMap((rule) => {
            const next = ruleRange(rule.range);
            return next ? [{ ...rule, range: next }] : [];
          });
        const hidden = change.axis === 'row' ? 'hiddenRows' : 'hiddenColumns';
        if (metadata[hidden])
          metadata[hidden] = metadata[hidden].flatMap((value) => {
            const next = move(value);
            return next === undefined || next >= limit ? [] : [next];
          });
        if (metadata.freeze) {
          const key = change.axis === 'row' ? 'rows' : 'columns';
          const edge = metadata.freeze[key];
          metadata.freeze = {
            ...metadata.freeze,
            [key]:
              edge === 0 || change.index >= edge
                ? edge
                : Math.min(limit, move(edge) ?? change.index),
          };
        }
        // Inserting extends the sheet; deleting keeps its size, as in Excel.
        let used = 0;
        for (const key of Object.keys(cells))
          used = Math.max(used, parseCellAddress(key)![change.axis] + 1);
        const grown = (count: number) =>
          Math.min(
            limit,
            Math.max(
              count + (change.kind === 'insert' ? change.count : 0),
              used
            )
          );
        if (change.axis === 'row') {
          if (metadata.rowHeights)
            metadata.rowHeights = movedRecord(metadata.rowHeights);
          layout = { ...layout, rowCount: grown(layout.rowCount) };
        } else
          layout = {
            ...layout,
            columnCount: grown(layout.columnCount),
            columnWidths: movedRecord(layout.columnWidths),
          };
      }
      return { ...sheet, cells, metadata, layout };
    });
  } finally {
    model.free();
  }
}
