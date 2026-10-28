// Completes a wasm-bindgen output directory as the @ironcalc/wasm package,
// as upstream's fix_types.py and fix_package.py do after wasm-pack.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2];
if (!out) throw new Error('Usage: bun scripts/package.ts <pkg dir>');
const here = join(import.meta.dir, '..');
const types = readFileSync(join(here, 'bindings/wasm/types.ts'), 'utf8');
const header = '/* tslint:disable */\n/* eslint-disable */';

// The binding returns these shapes as JsValue; replace their `any` types.
const declarations = readFileSync(join(out, 'wasm.d.ts'), 'utf8');
if (!declarations.startsWith(header))
  throw new Error('Unexpected wasm-bindgen declaration header.');
const typed = declarations.replace(header, `${header}\n\n${types}`);
let initOutput = false;
for (const line of typed.split('\n')) {
  const stripped = line.trimStart();
  // Raw wasm function signatures in InitOutput legitimately use `any`.
  if (stripped.startsWith('export interface InitOutput {')) initOutput = true;
  if (initOutput) {
    if (stripped === '}') initOutput = false;
    continue;
  }
  if (stripped.includes('any'))
    throw new Error(`Untyped public declaration: ${stripped}`);
}
writeFileSync(join(out, 'wasm.d.ts'), typed);

// The enums in types.ts are runtime values too.
const runtime = new Bun.Transpiler({ loader: 'ts' }).transformSync(types);
const glue = readFileSync(join(out, 'wasm.js'), 'utf8');
writeFileSync(join(out, 'wasm.js'), `${runtime}\n${glue}`);

const upstream = JSON.parse(
  readFileSync(join(here, 'upstream.json'), 'utf8')
) as { commit: string };
writeFileSync(
  join(out, 'package.json'),
  `${JSON.stringify(
    {
      name: '@ironcalc/wasm',
      type: 'module',
      description: `IronCalc Web bindings, vendored from IronCalc ${upstream.commit.slice(0, 7)} with Macro patches`,
      version: '0.8.4-macro.1',
      license: 'MIT OR Apache-2.0',
      repository: {
        type: 'git',
        url: 'https://github.com/ironcalc/IronCalc',
      },
      files: [
        'wasm_bg.wasm',
        'wasm.js',
        'wasm.d.ts',
        'wasm_bg.wasm.d.ts',
        'snippets',
      ],
      main: 'wasm.js',
      types: 'wasm.d.ts',
      sideEffects: ['./snippets/*'],
    },
    null,
    2
  )}\n`
);
