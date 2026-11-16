import { existsSync, readFileSync } from 'node:fs';
import { readWasmManifest } from '../../../../../scripts/wasm-manifest';
import { wasmPackageFiles } from '../../../../../scripts/wasm-modules';
import type { WasmModule } from '../define-wasm-module';

/**
 * Loads a `wasm:` module in Vitest from its built package on disk, since the
 * test environments can't fetch the binary. Fails like the app does, naming
 * the build command, when the package isn't built.
 */
export async function loadWasmForTest<Glue>(
  module: WasmModule<Glue>
): Promise<Glue> {
  const listed = readWasmManifest().find(({ name }) => name === module.name);
  if (!listed) throw new Error(`${module.name} is not in wasm-modules.json`);

  const { binary } = wasmPackageFiles(listed);
  if (!existsSync(binary)) return module.load();
  return module.load({ module: new WebAssembly.Module(readFileSync(binary)) });
}
