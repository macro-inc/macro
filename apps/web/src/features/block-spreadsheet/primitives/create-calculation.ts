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
  calculationInput,
  calculationInputs,
  workbookCalculationInputs,
} from '../core/calculation-inputs';
import type { CalculationSheetPatch } from '../core/calculation-protocol';
import type { SpreadsheetCells } from '../core/spreadsheet-document';
import type { SpreadsheetWorkbookSheet } from '../core/workbook-document';
import {
  CALCULATION_TIMEOUT_MS,
  createCalculationClient,
} from './calculation-client';
import type { SpreadsheetChanges } from './create-spreadsheet-store';

function sameInput(
  left: CalculationCells[string] | undefined,
  right: CalculationCells[string] | undefined
) {
  return (
    left === right ||
    (!!left &&
      !!right &&
      left.value === right.value &&
      left.format === right.format &&
      left.decimals === right.decimals &&
      left.numberFormat === right.numberFormat)
  );
}

/** Workbook state that lets calculation send only changed cells. */
type IncrementalSource = {
  revision: Accessor<number>;
  changesSince: (revision: number) => SpreadsheetChanges | undefined;
};

export function createCalculation(
  cells: Accessor<SpreadsheetCells>,
  rowCount: Accessor<number>,
  options:
    | typeof createCalculationClient
    | {
        makeClient?: typeof createCalculationClient;
        workbook: Accessor<SpreadsheetWorkbookSheet[]>;
        activeSheetId: Accessor<string>;
        incremental?: IncrementalSource;
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
    {},
    // Incremental results are patched in place.
    { equals: false }
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
        (workbookOptions?.incremental ? [] : workbookOptions?.workbook())?.map(
          (sheet) => ({
            id: sheet.id,
            name: sheet.name,
            cells: sheet.cells,
            rowCount: sheet.layout.rowCount,
            metadata: sheet.metadata,
          })
        ) ?? [],
        previous
      ),
    []
  );
  const sourceInputs = () => (workbookOptions ? workbookInputs() : inputs());
  const sourceRows = () => (workbookOptions ? 0 : rowCount());
  const context = (): CalculationContext | undefined =>
    workbookOptions
      ? {
          sheetNames: workbookOptions.workbook().map((sheet) => sheet.name),
          activeSheet: Math.max(
            0,
            workbookOptions
              .workbook()
              .findIndex(
                (sheet) => sheet.id === workbookOptions.activeSheetId()
              )
          ),
        }
      : undefined;
  let generation = 0;
  const incremental = workbookOptions?.incremental;
  if (incremental && workbookOptions) {
    // The worker keeps its own copy of the inputs; send only what changed and
    // apply only changed results, so large workbooks stay responsive.
    // The inputs last sent per sheet, compared field by field: a string key
    // per cell would double a large workbook's memory.
    const sent = new Map<string, Map<string, CalculationCells[string]>>();
    let sentEpoch = -1;
    let sentRevision = -1;
    let sentSheets = '';
    let running = false;
    let queued = false;
    const results: WorkbookCalculation = {};
    const patch = () => {
      const epoch = (calculator as { epoch?: () => number }).epoch?.() ?? 0;
      const changes =
        epoch === sentEpoch
          ? incremental.changesSince(sentRevision)
          : undefined;
      const sheets = workbookOptions.workbook();
      sentEpoch = epoch;
      sentRevision = incremental.revision();
      let changed = false;
      const patches: CalculationSheetPatch[] = sheets.map((sheet) => {
        const descriptor = {
          id: sheet.id,
          name: sheet.name,
          rowCount: sheet.layout.rowCount,
          metadata: {
            definedNames: sheet.metadata?.definedNames,
            arrayFormulas: sheet.metadata?.arrayFormulas,
          },
        };
        const previous = sent.get(sheet.id);
        if (
          !previous ||
          !changes ||
          (changes.has(sheet.id) && !changes.get(sheet.id))
        ) {
          const inputs = new Map<string, CalculationCells[string]>();
          const cells: CalculationCells = {};
          for (const address in sheet.cells) {
            const input = calculationInput(sheet.cells[address]);
            if (!input) continue;
            cells[address] = input;
            inputs.set(address, input);
          }
          sent.set(sheet.id, inputs);
          changed = true;
          return { ...descriptor, cells };
        }
        const delta: Record<string, CalculationCells[string] | null> = {};
        for (const address of changes.get(sheet.id) ?? []) {
          const input = calculationInput(sheet.cells[address]);
          if (sameInput(input, previous.get(address))) continue;
          if (input) previous.set(address, input);
          else previous.delete(address);
          delta[address] = input ?? null;
          changed = true;
        }
        return { ...descriptor, changes: delta };
      });
      for (const id of sent.keys())
        if (!sheets.some((sheet) => sheet.id === id)) sent.delete(id);
      const layout = JSON.stringify(
        patches.map(({ id, name, rowCount, metadata }) => [
          id,
          name,
          rowCount,
          metadata,
        ])
      );
      if (layout !== sentSheets) changed = true;
      sentSheets = layout;
      return { patches, changed };
    };
    const run = () => {
      if (running) {
        queued = true;
        return;
      }
      const { patches, changed } = patch();
      if (!changed) {
        setBusy(false);
        return;
      }
      running = true;
      setBusy(true);
      setError('');
      const entered = patches.reduce(
        (total, sheet) => total + Object.keys(sheet.cells ?? {}).length,
        0
      );
      let cells = 0;
      for (const keys of sent.values()) cells += keys.size;
      const current = ++generation;
      void calculator
        .run(
          { type: 'update-workbook', sheets: patches },
          // Entering a large workbook takes longer than recalculating it
          // after an edit, which still reevaluates every formula.
          CALCULATION_TIMEOUT_MS +
            Math.min(60_000, entered / 20) +
            Math.min(30_000, cells / 100)
        )
        .then((response) => {
          if (current !== generation || response.type !== 'update-workbook')
            return;
          for (const id of response.replaced) results[id] = {};
          for (const [id, delta] of Object.entries(response.values)) {
            results[id] ??= {};
            const target = results[id];
            for (const [address, value] of Object.entries(delta)) {
              if (value) target[address] = value;
              else delete target[address];
            }
          }
          for (const id of Object.keys(results))
            if (!workbookOptions.workbook().some((sheet) => sheet.id === id))
              delete results[id];
          setWorkbookValues(results);
        })
        .catch((cause: unknown) => {
          if (current !== generation) return;
          // A failed revision must not present old values as current after
          // the pending indicator disappears.
          for (const id of Object.keys(results)) delete results[id];
          setWorkbookValues(results);
          sent.clear();
          setError(
            cause instanceof Error ? cause.message : 'Unable to calculate.'
          );
        })
        .finally(() => {
          if (current !== generation) return;
          running = false;
          if (queued) {
            queued = false;
            run();
          } else setBusy(false);
        });
    };
    createEffect(
      on([workbookOptions.workbook, retryCount], ([, retries], previous) => {
        if (previous && retries !== previous[1]) sent.clear();
        const timer = setTimeout(run, 60);
        onCleanup(() => clearTimeout(timer));
      })
    );
  } else
    createEffect(
      on([sourceInputs, sourceRows, retryCount], () => {
        const current = ++generation;
        setBusy(true);
        setError('');
        // Keep the last complete result visible until this revision is ready.
        // Busy gates actions that depend on current values (export and sorting).
        const operation = workbookOptions
          ? { type: 'calculate-workbook' as const, sheets: workbookInputs() }
          : {
              type: 'calculate' as const,
              cells: inputs(),
              rowCount: rowCount(),
            };
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
