// The browser wasm modules apps/web builds with wasm-pack, read from
// apps/web/wasm-modules.json. That file is the one list of them: the build
// script (scripts/wasm.ts), the desktop release (nix/tauri-desktop.nix) and the
// CI workflow generators all read it.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

/** What a variant may change: a separate build of the same crate. */
const VARIANT_SCHEMA = z.strictObject({
  outDir: z.string().optional(),
  outName: z.string().optional(),
  profile: z.string().optional(),
  features: z.array(z.string()).optional(),
});

const MODULE_SCHEMA = z.strictObject({
  /** Kebab-case name the build commands take, e.g. `just build-wasm pptx-engine`. */
  name: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  /** Cargo package name; also its key in `wasm_closures` of workspace-dep-closures.json. */
  package: z.string(),
  /** Crate directory, relative to the repository root. */
  crateDir: z.string(),
  /** wasm-pack output directory, relative to apps/web. */
  outDir: z.string(),
  /** wasm-pack `--out-name`: the glue is `<outName>.js`, the binary `<outName>_bg.wasm`. */
  outName: z.string(),
  /** `release` or a named profile from the root Cargo.toml. */
  profile: z.string(),
  defaultFeatures: z.boolean(),
  features: z.array(z.string()),
  /** Extra rustc flags for the wasm32 target, joined with spaces. */
  rustflags: z.array(z.string()),
  /** Non-source paths the build embeds (fonts, assets), relative to the repository root. */
  extraWatch: z.array(z.string()),
  /** Where the app runs the module. */
  thread: z.enum(['main', 'worker']),
  /** Separate builds of the crate for tests and profiling, built only on request. */
  variants: z.record(z.string(), VARIANT_SCHEMA).optional(),
});

const MANIFEST_SCHEMA = z.strictObject({
  modules: z.array(MODULE_SCHEMA),
});

export type WasmModule = z.infer<typeof MODULE_SCHEMA>;
export type WasmModuleVariant = z.infer<typeof VARIANT_SCHEMA>;

export const WASM_MANIFEST_PATH = join(import.meta.dirname, '..', 'wasm-modules.json');

export function readWasmManifest(path: string = WASM_MANIFEST_PATH): WasmModule[] {
  const manifest = MANIFEST_SCHEMA.parse(JSON.parse(readFileSync(path, 'utf8')));

  const names = new Set<string>();
  for (const module of manifest.modules) {
    if (names.has(module.name)) {
      throw new Error(`${path}: module ${module.name} is listed twice`);
    }
    names.add(module.name);
  }

  return manifest.modules;
}
