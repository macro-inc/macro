import { initSync } from '@ironcalc/wasm';
import wasmModule from '@ironcalc/wasm/wasm_bg.wasm';
import { createInitializedSpreadsheetCalculator } from '@macro-inc/spreadsheet/calculation';

/** Cloudflare supplies a precompiled module; no runtime WASM compilation/fetch. */
export function createWorkerSpreadsheetCalculator() {
  initSync({ module: wasmModule });
  return createInitializedSpreadsheetCalculator();
}
