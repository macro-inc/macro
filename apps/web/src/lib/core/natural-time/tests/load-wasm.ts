import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { NaturalTimeWasmModule } from '../wasm-module';

type TestModule = NaturalTimeWasmModule & {
  initSync: (input: { module: Uint8Array }) => unknown;
};

/**
 * The built natural_time package, initialized synchronously: the test runner
 * serves modules over http, which the package's own loader refuses. Build it
 * with `just build-natural-time-wasm`.
 */
export async function loadNaturalTimeForTest(): Promise<NaturalTimeWasmModule> {
  const dir = `${process.cwd()}/src/lib/core/natural-time/wasm`;
  // Type checking also runs in jobs that do not build the ignored package.
  const url = pathToFileURL(`${dir}/natural_time.js`).href;
  const wasm = (await import(/* @vite-ignore */ url)) as TestModule;
  wasm.initSync({ module: readFileSync(`${dir}/natural_time_bg.wasm`) });
  return wasm;
}
