import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { WasmModule } from './wasm-manifest.ts';
import { wasmModules, wrapWasmGlue } from './wasm-modules.ts';

const EXAMPLE: WasmModule = {
  name: 'example',
  package: 'example',
  crateDir: 'crates/example',
  outDir: 'src/lib/core/example/wasm-not-built',
  outName: 'example',
  profile: 'release',
  defaultFeatures: true,
  features: [],
  rustflags: [],
  extraWatch: [],
  thread: 'main',
};

it('wraps the glue so that each instance has its own state', async () => {
  // The shape wasm-bindgen's `--target web` output has.
  const glue = `let wasm;
export function read() { return wasm; }
export class Reader { constructor() { this.wasm = wasm; } }
async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;
    if (module_or_path === undefined) {
        module_or_path = new URL('example_bg.wasm', import.meta.url);
    }
    wasm = module_or_path;
    return wasm;
}
function initSync(module) { wasm = module; return wasm; }
export { initSync, __wbg_init as default };
`;
  const wrapped = wrapWasmGlue(glue, EXAMPLE);
  const { instantiateGlue } = await import(
    `data:text/javascript,${encodeURIComponent(wrapped)}`
  );

  const first = instantiateGlue('/assets/example_bg-1.wasm');
  const second = instantiateGlue('/assets/example_bg-1.wasm');
  expect(await first.default()).toBe('/assets/example_bg-1.wasm');
  expect(first.read()).toBe('/assets/example_bg-1.wasm');
  expect(new first.Reader().wasm).toBe('/assets/example_bg-1.wasm');
  expect(second.read()).toBeUndefined();
  second.initSync('other');
  expect(second.read()).toBe('other');
  expect(first.read()).toBe('/assets/example_bg-1.wasm');
});

it('fails a production build that imports a module whose package is not built', () => {
  const directory = mkdtempSync(join(tmpdir(), 'wasm-modules-'));
  const manifest = join(directory, 'wasm-modules.json');
  writeFileSync(manifest, JSON.stringify({ modules: [EXAMPLE] }));
  const plugin = wasmModules(manifest);
  const context = {
    addWatchFile: () => {},
    error: (message: string) => {
      throw new Error(message);
    },
  };

  if (typeof plugin.configResolved !== 'function') throw new Error('hook');
  if (typeof plugin.load !== 'function') throw new Error('hook');
  Reflect.apply(plugin.configResolved, context, [
    { command: 'build', mode: 'production' },
  ]);

  expect(() => Reflect.apply(plugin.load as Function, context, ['\0wasm:example'])).toThrow(
    'The example wasm package is not built (no apps/web/src/lib/core/example/wasm-not-built/example.js). Run `just ensure-wasm example` in apps/web.'
  );
});
