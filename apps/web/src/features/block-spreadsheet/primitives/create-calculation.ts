import type { AxisChange } from '@macro-inc/spreadsheet/workbook-structure';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import type {
  CalculationContext,
  CellCopy,
  SpreadsheetCalculation,
  WorkbookCalculation,
} from '../core/calculation';
import {
  type CalculationCells,
  type CalculationWorkbookInput,
  calculationInputs,
  workbookCalculationInputs,
} from '../core/calculation-inputs';
import type { SpreadsheetCells } from '../core/spreadsheet-document';
import type { SpreadsheetWorkbookSheet } from '../core/workbook-document';
import { createCalculationClient } from './calculation-client';

export function createCalculation(
  cells: Accessor<SpreadsheetCells>,
  rowCount: Accessor<number>,
  options:
    | typeof createCalculationClient
    | {
        makeClient?: typeof createCalculationClient;
        workbook: Accessor<SpreadsheetWorkbookSheet[]>;
        activeSheetId: Accessor<string>;
      } = createCalculationClient
) {
  const makeClient =
    typeof options === 'function'
      ? options
      : (options.makeClient ?? createCalculationClient);
  const workbookOptions = typeof options === 'function' ? undefined : options;
  // Construct workers lazily after mount; eager module workers deadlock WKWebView.
  const calculator = makeClient();
  const copier = makeClient();
  const helper = makeClient();
  const [values, setValues] = createSignal<SpreadsheetCalculation>({});
  const [workbookValues, setWorkbookValues] = createSignal<WorkbookCalculation>(
    {}
  );
  const [busy, setBusy] = createSignal(true);
  const [error, setError] = createSignal('');
  const [retryCount, setRetryCount] = createSignal(0);
  const inputs = createMemo<CalculationCells>(
    (previous) => calculationInputs(workbookOptions ? {} : cells(), previous),
    {}
  );
  const workbookInputs = createMemo<CalculationWorkbookInput[]>(
    (previous) =>
      workbookCalculationInputs(
        workbookOptions?.workbook().map((sheet) => ({
          id: sheet.id,
          name: sheet.name,
          cells: sheet.cells,
          rowCount: sheet.layout.rowCount,
          metadata: sheet.metadata,
        })) ?? [],
        previous
      ),
    []
  );
  const sourceInputs = () => (workbookOptions ? workbookInputs() : inputs());
  const sourceRows = () => (workbookOptions ? 0 : rowCount());
  const context = (): CalculationContext | undefined =>
    workbookOptions
      ? {
          sheetNames: workbookInputs().map((sheet) => sheet.name),
          activeSheet: Math.max(
            0,
            workbookInputs().findIndex(
              (sheet) => sheet.id === workbookOptions.activeSheetId()
            )
          ),
        }
      : undefined;
  let generation = 0;

  createEffect(
    on([sourceInputs, sourceRows, retryCount], () => {
      const current = ++generation;
      setBusy(true);
      setError('');
      // Keep the last complete result visible until this revision is ready.
      // Busy gates actions that depend on current values (export and sorting).
      const operation = workbookOptions
        ? { type: 'calculate-workbook' as const, sheets: workbookInputs() }
        : { type: 'calculate' as const, cells: inputs(), rowCount: rowCount() };
      const timer = setTimeout(async () => {
        try {
          const result = await calculator.run(operation);
          if (current === generation && result.type === 'calculate')
            setValues(result.values);
          if (current === generation && result.type === 'calculate-workbook')
            setWorkbookValues(result.values);
        } catch (cause) {
          if (current === generation) {
            // A failed revision must not present old values as current after
            // the pending indicator disappears.
            setValues({});
            setWorkbookValues({});
            setError(
              cause instanceof Error ? cause.message : 'Unable to calculate.'
            );
          }
        } finally {
          if (current === generation) setBusy(false);
        }
      }, 60);
      onCleanup(() => clearTimeout(timer));
    })
  );
  onCleanup(() => {
    generation++;
    calculator.dispose();
    copier.dispose();
    helper.dispose();
  });

  return {
    values: workbookOptions
      ? () => workbookValues()[workbookOptions.activeSheetId()] ?? {}
      : values,
    workbookValues,
    busy,
    error,
    retry: () => setRetryCount((count) => count + 1),
    async complete(text: string, cursor: number) {
      const result = await helper.run({
        type: 'complete',
        text,
        cursor,
        ...(workbookOptions ? { context: context() } : {}),
      });
      return result.type === 'complete' ? result.context : undefined;
    },
    async changeAxis(sheets: SpreadsheetWorkbookSheet[], change: AxisChange) {
      const result = await copier.run({ type: 'change-axis', sheets, change });
      if (result.type !== 'change-axis')
        throw new Error('Unable to change sheet structure.');
      return result.sheets;
    },
    async copy(copies: CellCopy[]) {
      const result = await copier.run({
        type: 'copy',
        copies,
        ...(workbookOptions ? { context: context() } : {}),
      });
      if (result.type !== 'copy') throw new Error('Unable to copy cells.');
      return result.edits;
    },
  };
}
