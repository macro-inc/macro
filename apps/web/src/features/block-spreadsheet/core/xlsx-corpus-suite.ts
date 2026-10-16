import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initSync } from '@ironcalc/wasm';
import { createInitializedSpreadsheetCalculator } from '@macro-inc/spreadsheet/calculation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SpreadsheetCalculator, WorkbookCalculation } from './calculation';
import type { WorkbookFileData } from './workbook-file-types';
import { decodeXlsx, encodeXlsx } from './xlsx-codec';
import {
  type CalculationFidelity,
  calculateImported,
  calculationFidelity,
  corpusBytes,
  corpusEntries,
} from './xlsx-fixtures/corpus';

/**
 * The real-world corpus runs from `xlsx-corpus-1.test.ts` through
 * `xlsx-corpus-4.test.ts`, one slice each, so Vitest spreads the workbooks
 * across workers instead of running them serially in one file for a minute.
 * A slice takes every `CORPUS_SLICES`th manifest entry, so new workbooks
 * spread across the files.
 */
export const CORPUS_SLICES = 4;

type CorpusSummary = {
  error?: string;
  sheets?: number;
  cells?: number;
  formulas?: number;
  styledCells?: number;
  calculation?: Omit<CalculationFidelity, 'examples'> | string;
  roundTrip?: 'identical' | string;
  warnings?: string[];
};

function counts(workbook: WorkbookFileData) {
  const cells = workbook.sheets.flatMap((sheet) => Object.values(sheet.cells));
  return {
    sheets: workbook.sheets.length,
    cells: cells.filter((cell) => cell.value !== '').length,
    formulas: cells.filter(
      (cell) => cell.value.startsWith('=') && cell.format !== 'text'
    ).length,
    styledCells: cells.filter((cell) => Object.keys(cell).length > 1).length,
  };
}

/** The first difference between two imports, or `identical`. */
function roundTripDifference(
  first: WorkbookFileData,
  second: WorkbookFileData
): string {
  if (first.sheets.length !== second.sheets.length)
    return `sheet count ${first.sheets.length} → ${second.sheets.length}`;
  for (const [index, sheet] of first.sheets.entries()) {
    const other = second.sheets[index];
    if (sheet.name !== other.name) return `sheet name ${sheet.name}`;
    const addresses = new Set([
      ...Object.keys(sheet.cells),
      ...Object.keys(other.cells),
    ]);
    for (const address of addresses) {
      const before = JSON.stringify(sheet.cells[address] ?? null);
      const after = JSON.stringify(other.cells[address] ?? null);
      if (before !== after)
        return `${sheet.name}!${address} ${before} → ${after}`;
    }
    if (JSON.stringify(sheet.metadata) !== JSON.stringify(other.metadata))
      return `${sheet.name} metadata`;
    if (
      JSON.stringify(sheet.columnWidths) !== JSON.stringify(other.columnWidths)
    )
      return `${sheet.name} column widths`;
  }
  return 'identical';
}

/**
 * Imports, recalculates and round-trips slice `slice` (1-based) of the corpus.
 * `corpusEntries` fails when a workbook lacks provenance in `manifest.json`.
 */
export function describeCorpusSlice(slice: number) {
  if (!Number.isInteger(slice) || slice < 1 || slice > CORPUS_SLICES)
    throw new Error(`Corpus slice must be 1–${CORPUS_SLICES}, got ${slice}`);
  const entries = corpusEntries().filter(
    (_, index) => index % CORPUS_SLICES === slice - 1
  );

  let calculator: SpreadsheetCalculator;
  beforeAll(() => {
    initSync({
      module: readFileSync(
        createRequire(import.meta.url).resolve('@ironcalc/wasm/wasm_bg.wasm')
      ),
    });
    calculator = createInitializedSpreadsheetCalculator();
  });
  afterAll(() => calculator.dispose());

  // Snapshot names stay `real-world XLSX corpus > <file>` in every slice.
  describe('real-world XLSX corpus', () => {
    it.each(entries)(
      '$file',
      async (entry) => {
        const bytes = corpusBytes(entry);
        const summary: CorpusSummary = {};
        let imported: WorkbookFileData;
        try {
          imported = await decodeXlsx(bytes);
        } catch (error) {
          summary.error =
            error instanceof Error ? error.message : String(error);
          expect(summary).toMatchSnapshot();
          return;
        }
        Object.assign(summary, counts(imported));
        summary.warnings = [...imported.warnings].sort();
        let values: WorkbookCalculation = {};
        if (entry.skipCalculation) summary.calculation = entry.skipCalculation;
        else {
          values = calculateImported(calculator, imported, bytes);
          const { examples, ...calculation } = calculationFidelity(
            bytes,
            imported,
            values
          );
          summary.calculation = calculation;
          if (process.env.XLSX_CORPUS_VERBOSE)
            console.info(entry.file, JSON.stringify(calculation), examples);
        }
        try {
          const exported = await encodeXlsx({
            sheets: imported.sheets.map((sheet, index) => ({
              ...sheet,
              values: values[String(index)],
            })),
            images: imported.images,
          });
          summary.roundTrip = roundTripDifference(
            imported,
            await decodeXlsx(exported.bytes)
          );
        } catch (error) {
          summary.roundTrip = `export failed: ${error instanceof Error ? error.message : String(error)}`;
        }
        expect(summary).toMatchSnapshot();
      },
      120_000
    );
  });
}
