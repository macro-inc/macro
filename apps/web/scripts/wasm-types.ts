// Writes the checked-in types of the `wasm:` modules (see wasm-modules.ts):
// the `declare module` file from wasm-modules.json, and a copy of each built
// package's wasm-bindgen declarations. With --check it changes nothing and
// fails when either is out of date; packages that aren't built are skipped.
//
// usage: bun scripts/wasm-types.ts [--check]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readWasmManifest } from './wasm-manifest.ts';
import {
  WASM_DECLARATIONS_DIR,
  wasmDeclarationCopyPath,
  wasmModuleDeclarations,
  wasmPackageFiles,
} from './wasm-modules.ts';

const check = process.argv.includes('--check');
const modules = readWasmManifest();
const stale: string[] = [];

const expect = (path: string, contents: string) => {
  if (existsSync(path) && readFileSync(path, 'utf8') === contents) return;
  if (check) {
    stale.push(relative(process.cwd(), path));
    return;
  }
  mkdirSync(WASM_DECLARATIONS_DIR, { recursive: true });
  writeFileSync(path, contents);
  console.log(`wrote ${relative(process.cwd(), path)}`);
};

expect(
  join(WASM_DECLARATIONS_DIR, 'modules.d.ts'),
  wasmModuleDeclarations(modules)
);

for (const module of modules) {
  const { declaration } = wasmPackageFiles(module);
  const copy = wasmDeclarationCopyPath(module);
  if (existsSync(declaration)) {
    expect(copy, readFileSync(declaration, 'utf8'));
  } else if (!existsSync(copy)) {
    // Nothing to copy from, and type checking needs the copy.
    stale.push(`${relative(process.cwd(), copy)} (run \`just ensure-wasm ${module.name}\` first)`);
  }
}

if (stale.length > 0) {
  console.error(
    `The wasm module types are out of date. Run \`bun scripts/wasm-types.ts\` in apps/web:\n  ${stale.join('\n  ')}`
  );
  process.exit(1);
}
