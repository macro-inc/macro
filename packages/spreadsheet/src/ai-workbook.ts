import type { LoroDoc } from 'loro-crdt';
import type {
  SpreadsheetCalculateRequest,
  SpreadsheetCalculateResponse,
  SpreadsheetEditRequest,
  SpreadsheetEditResponse,
  SpreadsheetOperation,
  SpreadsheetReadCell,
  SpreadsheetReadRequest,
  SpreadsheetReadResponse,
  SpreadsheetSheetSummary,
  SpreadsheetValue,
} from './ai-types';
import type {
  CalculatedCell,
  SpreadsheetCalculator,
  WorkbookCalculation,
} from './calculation';
import { fillCopies } from './cell-copy';
import {
  type CellSelection,
  selectionAddresses,
  selectionBounds,
} from './grid-selection';
import { qualifyScratchFormula } from './scratch-formula';
import {
  appendSpreadsheetRows,
  formatCellAddress,
  isSpreadsheetCellStyle,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  parseCellAddress,
  resizeSpreadsheetColumn,
  SPREADSHEET_COLUMNS,
  SPREADSHEET_DEFAULT_STYLE,
  SPREADSHEET_MAX_CELL_LENGTH,
  SPREADSHEET_MAX_ROWS,
  type SpreadsheetCell,
  type SpreadsheetCellEdits,
  type SpreadsheetCellStyle,
  writeSpreadsheetCells,
} from './spreadsheet-document';
import {
  addSpreadsheetSheet,
  deleteSpreadsheetSheet,
  duplicateSpreadsheetSheet,
  readSpreadsheetWorkbook,
  renameSpreadsheetSheet,
  type SpreadsheetWorkbookSheet,
} from './workbook-document';

export const SPREADSHEET_AI_LIMITS = {
  readCells: 500,
  formulas: 20,
  operations: 25,
  editCells: 2_000,
  responseBytes: 100_000,
} as const;

/** Strict native shape check: never reinterpret markdown as a blank sheet. */
export function assertSpreadsheetDocument(doc: LoroDoc): void {
  if (doc.getMap('spreadsheetMeta').get('formatVersion') !== 1)
    throw new Error('This is not a supported native Macro spreadsheet.');
}

function resolveSheet(
  workbook: SpreadsheetWorkbookSheet[],
  reference?: string
) {
  if (reference === undefined) return workbook[0];
  const sheet =
    workbook.find((item) => item.id === reference) ??
    workbook.find(
      (item) => item.name.toLowerCase() === reference.toLowerCase()
    );
  if (!sheet)
    throw new Error(
      `Sheet “${reference}” does not exist. Read the workbook to get its current sheet IDs.`
    );
  return sheet;
}

function address(value: string) {
  const normalized = value.trim().toUpperCase();
  const position = parseCellAddress(normalized);
  if (!position)
    throw new Error(
      `Invalid cell address “${value}”. Use A1:Z1000 addresses without a sheet prefix.`
    );
  return { normalized, position };
}

export function parseSpreadsheetRange(value: string): CellSelection {
  const parts = value.split(':');
  if (parts.length > 2 || !parts[0])
    throw new Error(`Invalid range “${value}”. Use A1 or A1:B10.`);
  const anchor = address(parts[0]).position;
  const focus = address(parts[1] ?? parts[0]).position;
  return { anchor, focus };
}

function rangeName(selection: CellSelection) {
  const bounds = selectionBounds(selection);
  const first = formatCellAddress(bounds.top, bounds.left);
  const last = formatCellAddress(bounds.bottom, bounds.right);
  return first === last ? first : `${first}:${last}`;
}

function checkedRange(value: string, sheet: SpreadsheetWorkbookSheet) {
  const selection = parseSpreadsheetRange(value);
  if (selectionBounds(selection).bottom >= sheet.layout.rowCount)
    throw new Error(
      `Range ${value} exceeds ${sheet.name}'s ${sheet.layout.rowCount} rows. Append rows first.`
    );
  return selection;
}

function calculate(
  workbook: SpreadsheetWorkbookSheet[],
  calculator: SpreadsheetCalculator
) {
  return calculator.calculateWorkbook(
    workbook.map((sheet) => ({ ...sheet, rowCount: sheet.layout.rowCount })),
    { includeTypes: true }
  );
}

function typedValue(result?: CalculatedCell): SpreadsheetValue {
  if (!result) return { type: 'blank', value: null, display: '' };
  return {
    type:
      result.type ??
      (result.error
        ? 'error'
        : result.number === undefined
          ? 'text'
          : 'number'),
    value:
      result.value ?? result.number ?? (result.error ? null : result.display),
    display: result.display,
    ...(result.error && { error: result.error }),
  };
}

function usedRange(
  sheet: SpreadsheetWorkbookSheet,
  result: Record<string, CalculatedCell>
) {
  const positions = [
    ...new Set([
      ...Object.keys(sheet.cells).filter(
        (key) => sheet.cells[key].value !== ''
      ),
      ...Object.keys(result),
    ]),
  ]
    .map((key) => parseCellAddress(key))
    .filter((item) => item !== undefined);
  if (!positions.length) return null;
  return rangeName({
    anchor: {
      row: Math.min(...positions.map((item) => item.row)),
      column: Math.min(...positions.map((item) => item.column)),
    },
    focus: {
      row: Math.max(...positions.map((item) => item.row)),
      column: Math.max(...positions.map((item) => item.column)),
    },
  });
}

function summaries(
  workbook: SpreadsheetWorkbookSheet[],
  results: WorkbookCalculation
): SpreadsheetSheetSummary[] {
  return workbook.map((sheet) => ({
    id: sheet.id,
    name: sheet.name,
    rowCount: sheet.layout.rowCount,
    columnCount: SPREADSHEET_COLUMNS,
    usedRange: usedRange(sheet, results[sheet.id] ?? {}),
    populatedCells: Object.values(sheet.cells).filter(
      (cell) => cell.value !== ''
    ).length,
    formulaCells: Object.values(sheet.cells).filter(
      (cell) => cell.format !== 'text' && cell.value.startsWith('=')
    ).length,
    errorCells: Object.values(results[sheet.id] ?? {}).filter(
      (cell) => cell.error
    ).length,
  }));
}

function readCell(
  key: string,
  cell: SpreadsheetCell | undefined,
  result: CalculatedCell | undefined,
  includeStyles: boolean
): SpreadsheetReadCell {
  const source = cell?.value ?? '';
  const { value: _value, ...style } = cell ?? { value: '' };
  return {
    address: key,
    source,
    ...typedValue(result),
    ...(source.startsWith('=') &&
      cell?.format !== 'text' && { formula: source }),
    ...(includeStyles && { style }),
  };
}

export function readSpreadsheetForAi(
  doc: LoroDoc,
  revision: string,
  request: SpreadsheetReadRequest,
  calculator: SpreadsheetCalculator
): SpreadsheetReadResponse {
  assertSpreadsheetDocument(doc);
  const workbook = readSpreadsheetWorkbook(doc);
  const results = calculate(workbook, calculator);
  const sheets = summaries(workbook, results);
  const sheet = resolveSheet(workbook, request.sheetId);
  const requested = request.ranges?.length
    ? request.ranges
    : [sheets.find((item) => item.id === sheet.id)?.usedRange ?? 'A1'];
  if (requested.length > 20)
    throw new Error('Read at most 20 ranges at a time.');
  let remaining = SPREADSHEET_AI_LIMITS.readCells;
  let bytes = SPREADSHEET_AI_LIMITS.responseBytes;
  const ranges = requested.map((range) => {
    const selection = checkedRange(range, sheet);
    const cells: SpreadsheetReadCell[] = [];
    let truncated = false;
    for (const key of selectionAddresses(selection)) {
      const cell = sheet.cells[key];
      const result = results[sheet.id]?.[key];
      // Sparse output; style-only cells are relevant only when requested.
      if (!cell?.value && !result && !(request.includeStyles && cell)) continue;
      const item = readCell(key, cell, result, request.includeStyles ?? false);
      const size = new TextEncoder().encode(JSON.stringify(item)).length;
      if (!remaining || size > bytes) {
        truncated = true;
        continue;
      }
      cells.push(item);
      remaining--;
      bytes -= size;
    }
    return {
      sheetId: sheet.id,
      sheetName: sheet.name,
      range: rangeName(selection),
      cells,
      truncated,
    };
  });
  return {
    action: 'read',
    revision,
    sheets,
    ranges,
    warnings: ranges.some((range) => range.truncated)
      ? [
          'Results were limited to 500 cells or 100,000 bytes. Read smaller ranges for the remaining cells.',
        ]
      : [],
  };
}

function validateInputs(
  cells: { address: string; value: string }[],
  sheet: SpreadsheetWorkbookSheet
) {
  const edits: SpreadsheetCellEdits = {};
  for (const cell of cells) {
    const key = address(cell.address);
    if (key.position.row >= sheet.layout.rowCount)
      throw new Error(
        `Cell ${key.normalized} exceeds ${sheet.name}'s ${sheet.layout.rowCount} rows. Append rows first.`
      );
    if (cell.value.length > SPREADSHEET_MAX_CELL_LENGTH)
      throw new Error(`Cell ${key.normalized} exceeds 10,000 characters.`);
    if (key.normalized in edits)
      throw new Error(
        `Cell ${key.normalized} is specified twice in one operation.`
      );
    edits[key.normalized] = { value: cell.value };
  }
  return edits;
}

export function calculateSpreadsheetForAi(
  doc: LoroDoc,
  revision: string,
  request: SpreadsheetCalculateRequest,
  calculator: SpreadsheetCalculator
): SpreadsheetCalculateResponse {
  assertSpreadsheetDocument(doc);
  if (
    !request.formulas.length ||
    request.formulas.length > SPREADSHEET_AI_LIMITS.formulas
  )
    throw new Error('Calculate between 1 and 20 formulas at a time.');
  const workbook = readSpreadsheetWorkbook(doc);
  const sheet = resolveSheet(workbook, request.sheetId);
  let edited = 0;
  for (const override of request.overrides ?? []) {
    const target = resolveSheet(workbook, override.sheetId);
    edited += override.cells.length;
    if (edited > SPREADSHEET_AI_LIMITS.editCells)
      throw new Error('Override at most 2,000 cells at a time.');
    const edits = validateInputs(override.cells, target);
    for (const [key, edit] of Object.entries(edits))
      target.cells[key] = { ...target.cells[key], value: edit?.value ?? '' };
  }
  // Each formula gets an independent private sheet. There is no source-cell
  // collision, no result-to-result reference, and no accidental circular SUM.
  const scratchSheets = request.formulas.map(({ formula }, index) => {
    if (
      !formula.startsWith('=') ||
      formula.length > SPREADSHEET_MAX_CELL_LENGTH
    )
      throw new Error(
        'Scratch formulas must start with = and contain at most 10,000 characters.'
      );
    let name = `__MacroScratch_${index}`;
    while (
      workbook.some((item) => item.name.toLowerCase() === name.toLowerCase())
    )
      name += '_';
    const scratchId = `__macro_scratch_${crypto.randomUUID()}`;
    const scratch: SpreadsheetWorkbookSheet = {
      id: scratchId,
      name,
      cells: { A1: { value: qualifyScratchFormula(formula, sheet.name) } },
      layout: { rowCount: 200, columnWidths: {} },
    };
    return scratch;
  });
  const calculated = calculate([...workbook, ...scratchSheets], calculator);
  const results = request.formulas.map(({ label, formula }, index) => ({
    ...(label !== undefined && { label }),
    formula,
    ...typedValue(calculated[scratchSheets[index].id]?.A1),
  }));
  if (
    new TextEncoder().encode(JSON.stringify(results)).length >
    SPREADSHEET_AI_LIMITS.responseBytes
  )
    throw new Error(
      'Scratch results exceed 100,000 bytes. Calculate fewer formulas or return shorter results.'
    );
  return {
    action: 'calculate',
    revision,
    results,
    warnings: [
      'Scratch formulas return their top-left value and never change the workbook. Unqualified references use the selected sheet; INDIRECT is not supported in scratch calculations.',
    ],
  };
}

function knownStyle(style: SpreadsheetCellStyle) {
  if (
    !isSpreadsheetCellStyle(style) ||
    Object.keys(style).some(
      (key) => !Object.hasOwn(SPREADSHEET_DEFAULT_STYLE, key)
    )
  )
    throw new Error(
      'Invalid cell formatting. Use the supported spreadsheet style fields.'
    );
}

function operationRange(operation: SpreadsheetOperation): string | undefined {
  if ('range' in operation) return operation.range;
  if ('targetRange' in operation) return operation.targetRange;
  return undefined;
}

/** All mutations happen on a disposable fork; a failed batch changes nothing. */
export function prepareSpreadsheetEdit(
  doc: LoroDoc,
  request: SpreadsheetEditRequest,
  calculator: SpreadsheetCalculator,
  peerId?: bigint
) {
  assertSpreadsheetDocument(doc);
  if (
    !request.operations.length ||
    request.operations.length > SPREADSHEET_AI_LIMITS.operations
  )
    throw new Error('Edit between 1 and 25 operations at a time.');
  const fork = doc.fork();
  if (peerId !== undefined) fork.setPeerId(peerId);
  const before = doc.version();
  const changes: SpreadsheetEditResponse['changes'] = [];
  let edited = 0;
  const count = (amount: number) => {
    edited += amount;
    if (edited > SPREADSHEET_AI_LIMITS.editCells)
      throw new Error(
        'A batch may edit at most 2,000 cells. Split the change into smaller batches.'
      );
  };
  try {
    for (const operation of request.operations) {
      const workbook = readSpreadsheetWorkbook(fork);
      let sheet =
        'sheetId' in operation
          ? resolveSheet(workbook, operation.sheetId)
          : undefined;
      let summary: string;
      if (operation.type === 'add_sheet') {
        const id = addSpreadsheetSheet(fork, operation.name);
        sheet = resolveSheet(readSpreadsheetWorkbook(fork), id);
        summary = `Added sheet “${sheet.name}”.`;
      } else {
        if (!sheet) throw new Error('This operation requires a sheet.');
        switch (operation.type) {
          case 'set_cells': {
            count(operation.cells.length);
            writeSpreadsheetCells(
              fork,
              validateInputs(operation.cells, sheet),
              sheet.id
            );
            summary = `Set ${operation.cells.length} cell(s) in “${sheet.name}”.`;
            break;
          }
          case 'format_cells': {
            knownStyle(operation.style);
            const addresses = selectionAddresses(
              checkedRange(operation.range, sheet)
            );
            count(addresses.length);
            writeSpreadsheetCells(
              fork,
              Object.fromEntries(
                addresses.map((key) => [key, operation.style])
              ),
              sheet.id
            );
            summary = `Formatted ${addresses.length} cell(s) in “${sheet.name}”.`;
            break;
          }
          case 'clear_cells': {
            const addresses = selectionAddresses(
              checkedRange(operation.range, sheet)
            );
            count(addresses.length);
            writeSpreadsheetCells(
              fork,
              Object.fromEntries(
                addresses.map((key) => [
                  key,
                  operation.clearFormatting ? null : { value: '' },
                ])
              ),
              sheet.id
            );
            summary = `Cleared ${addresses.length} cell(s) in “${sheet.name}”.`;
            break;
          }
          case 'fill_cells': {
            const source = checkedRange(operation.sourceRange, sheet);
            const target = checkedRange(operation.targetRange, sheet);
            const copies = fillCopies(sheet.cells, source, target);
            count(copies.length);
            const edits = calculator.copy(copies, {
              sheetNames: workbook.map((item) => item.name),
              activeSheet: workbook.findIndex((item) => item.id === sheet?.id),
            });
            writeSpreadsheetCells(fork, edits, sheet.id);
            summary = `Filled ${copies.length} cell(s) from ${operation.sourceRange} in “${sheet.name}”.`;
            break;
          }
          case 'rename_sheet':
            renameSpreadsheetSheet(fork, sheet.id, operation.name);
            summary = `Renamed “${sheet.name}” to “${operation.name}”.`;
            break;
          case 'duplicate_sheet': {
            count(Object.keys(sheet.cells).length);
            const id = duplicateSpreadsheetSheet(fork, sheet.id);
            if (operation.name !== undefined)
              renameSpreadsheetSheet(fork, id, operation.name);
            sheet = resolveSheet(readSpreadsheetWorkbook(fork), id);
            summary = `Duplicated sheet as “${sheet.name}”.`;
            break;
          }
          case 'delete_sheet':
            count(Object.keys(sheet.cells).length);
            deleteSpreadsheetSheet(fork, sheet.id);
            summary = `Deleted sheet “${sheet.name}”.`;
            break;
          case 'append_rows':
            if (
              !Number.isInteger(operation.count) ||
              operation.count < 1 ||
              sheet.layout.rowCount + operation.count > SPREADSHEET_MAX_ROWS
            )
              throw new Error(
                `Append a positive row count without exceeding ${SPREADSHEET_MAX_ROWS} rows.`
              );
            appendSpreadsheetRows(fork, operation.count, sheet.id);
            summary = `Added ${operation.count} rows to “${sheet.name}”.`;
            break;
          case 'resize_columns':
            if (
              !operation.columns.length ||
              operation.columns.length > SPREADSHEET_COLUMNS
            )
              throw new Error('Resize between 1 and 26 columns.');
            for (const column of operation.columns) {
              if (
                !/^[A-Z]$/i.test(column.column) ||
                !Number.isInteger(column.width) ||
                column.width < MIN_COLUMN_WIDTH ||
                column.width > MAX_COLUMN_WIDTH
              )
                throw new Error(
                  `Columns must be A–Z and widths must be ${MIN_COLUMN_WIDTH}–${MAX_COLUMN_WIDTH} pixels.`
                );
              resizeSpreadsheetColumn(
                fork,
                column.column.toUpperCase().charCodeAt(0) - 65,
                column.width,
                sheet.id
              );
            }
            summary = `Resized ${operation.columns.length} column(s) in “${sheet.name}”.`;
            break;
        }
      }
      const range = operationRange(operation);
      changes.push({
        type: operation.type,
        sheetId: sheet.id,
        summary,
        ...(range && { range }),
      });
    }
    fork.commit({ origin: 'spreadsheet-ai-edit' });
    const workbook = readSpreadsheetWorkbook(fork);
    const results = calculate(workbook, calculator);
    const sheets = summaries(workbook, results);
    const errors = sheets.reduce((sum, item) => sum + item.errorCells, 0);
    return {
      update: fork.export({ mode: 'update', from: before }),
      changes,
      sheets,
      warnings: errors
        ? [
            `The resulting workbook contains ${errors} formula error(s). Read the affected ranges to inspect them.`,
          ]
        : [],
    };
  } finally {
    fork.free();
  }
}
