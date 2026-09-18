import initializeIronCalc from '@ironcalc/wasm';
import wasmUrl from '@ironcalc/wasm/wasm_bg.wasm?url';
import {
  createInitializedSpreadsheetCalculator,
  type SpreadsheetCalculator,
} from '@macro-inc/spreadsheet/calculation';

export * from '@macro-inc/spreadsheet/calculation';

// Browser-specific WASM loading stays here; calculation is shared with AI tools.
let initialization: Promise<unknown> | undefined;
export async function createSpreadsheetCalculator(): Promise<SpreadsheetCalculator> {
  initialization ??= initializeIronCalc({ module_or_path: wasmUrl }).catch(
    (error) => {
      initialization = undefined;
      throw error;
    }
  );
  await initialization;
  return createInitializedSpreadsheetCalculator();
}
