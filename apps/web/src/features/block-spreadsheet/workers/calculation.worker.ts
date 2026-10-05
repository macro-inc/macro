import { match } from 'ts-pattern';
import {
  type CalculatedCell,
  createSpreadsheetCalculator,
  type SpreadsheetCalculator,
  type WorkbookCalculation,
  type WorkbookCalculationSession,
} from '../core/calculation';
import type { CalculationCells } from '../core/calculation-inputs';
import type {
  CalculationRequest,
  CalculationResponse,
  CalculationSheetPatch,
} from '../core/calculation-protocol';

const calculator = createSpreadsheetCalculator();

// The worker keeps the workbook's inputs, results and engine model, so each
// edit sends and returns only what changed, and enters only changed cells.
let inputs = new Map<
  string,
  Omit<CalculationSheetPatch, 'changes'> & { cells: CalculationCells }
>();
let previous: WorkbookCalculation = {};
let session: WorkbookCalculationSession | undefined;
/** The sheets, names, rows and arrays of the workbook the session holds. */
let loaded: string | undefined;

function sameResult(left: CalculatedCell, right: CalculatedCell) {
  return (
    left.display === right.display &&
    left.number === right.number &&
    left.error === right.error &&
    left.warning === right.warning &&
    left.type === right.type &&
    left.value === right.value &&
    left.spill?.rows === right.spill?.rows &&
    left.spill?.columns === right.spill?.columns &&
    JSON.stringify(left.conditional) === JSON.stringify(right.conditional)
  );
}

function updateWorkbook(
  engine: SpreadsheetCalculator,
  id: number,
  sheets: CalculationSheetPatch[]
): CalculationResponse {
  const next = new Map<
    string,
    Omit<CalculationSheetPatch, 'changes'> & { cells: CalculationCells }
  >();
  const changes: Record<
    string,
    Record<string, CalculationCells[string] | null>
  > = {};
  let replacedInputs = false;
  for (const { changes: delta, cells, ...sheet } of sheets) {
    if (cells || !inputs.has(sheet.id)) replacedInputs = true;
    const current = cells ?? inputs.get(sheet.id)?.cells ?? {};
    for (const [address, input] of Object.entries(delta ?? {})) {
      if (input) current[address] = input;
      else delete current[address];
    }
    if (delta && Object.keys(delta).length) changes[sheet.id] = delta;
    next.set(sheet.id, { ...sheet, cells: current });
  }
  inputs = next;
  const structure = JSON.stringify(
    [...inputs.values()].map(({ id, name, rowCount, metadata, pivots }) => [
      id,
      name,
      rowCount,
      metadata ?? null,
      pivots ?? null,
    ])
  );
  session ??= engine.session();
  if (!replacedInputs && structure === loaded) {
    try {
      // `previous` is the session's own result map, which it keeps current.
      const values = session.update(changes, { includeTypes: true });
      return { id, type: 'update-workbook', values, replaced: [] };
    } catch {
      // The session dropped its model, and may have changed results the
      // editor never received: calculate and send the whole workbook.
      loaded = undefined;
      previous = {};
    }
  }
  const results = session.load(
    [...inputs.values()].map((sheet) => ({
      id: sheet.id,
      name: sheet.name,
      cells: sheet.cells,
      rowCount: sheet.rowCount,
      metadata: sheet.metadata,
      pivots: sheet.pivots,
    })),
    { includeTypes: true }
  );
  loaded = structure;
  const values: Record<string, Record<string, CalculatedCell | null>> = {};
  const replaced: string[] = [];
  for (const [sheetId, sheetResults] of Object.entries(results)) {
    const before = previous[sheetId];
    if (!before) {
      replaced.push(sheetId);
      values[sheetId] = sheetResults;
      continue;
    }
    const delta: Record<string, CalculatedCell | null> = {};
    for (const [address, result] of Object.entries(sheetResults))
      if (!before[address] || !sameResult(before[address], result))
        delta[address] = result;
    for (const address of Object.keys(before))
      if (!(address in sheetResults)) delta[address] = null;
    values[sheetId] = delta;
  }
  previous = results;
  return { id, type: 'update-workbook', values, replaced };
}
self.onmessage = async (event: MessageEvent<CalculationRequest>) => {
  const request = event.data;
  let response: CalculationResponse;
  try {
    const engine = await calculator;
    self.postMessage({
      id: request.id,
      type: 'started',
    } satisfies CalculationResponse);
    response = match(request)
      .returnType<CalculationResponse>()
      .with({ type: 'change-axis' }, (operation) => ({
        id: operation.id,
        type: 'change-axis',
        sheets: engine.changeAxis(operation.sheets, operation.change),
      }))
      .with({ type: 'calculate' }, (operation) => ({
        id: operation.id,
        type: 'calculate',
        values: engine.calculate(operation.cells, operation.rowCount),
      }))
      .with({ type: 'update-workbook' }, (operation) =>
        updateWorkbook(engine, operation.id, operation.sheets)
      )
      .with({ type: 'calculate-workbook' }, (operation) => ({
        id: operation.id,
        type: 'calculate-workbook',
        values: engine.calculateWorkbook(operation.sheets, {
          includeTypes: true,
        }),
      }))
      .with({ type: 'copy' }, (operation) => ({
        id: operation.id,
        type: 'copy',
        edits: engine.copy(operation.copies, operation.context),
      }))
      .with({ type: 'complete' }, (operation) => ({
        id: operation.id,
        type: 'complete',
        context: engine.complete(
          operation.text,
          operation.cursor,
          operation.context
        ),
      }))
      .exhaustive();
  } catch (error) {
    response = {
      id: request.id,
      type: 'error',
      message: error instanceof Error ? error.message : 'Calculation failed.',
    };
  }
  self.postMessage(response);
};
