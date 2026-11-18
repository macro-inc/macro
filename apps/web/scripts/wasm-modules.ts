// The `wasm:` Vite plugin: `import naturalTime from 'wasm:natural-time'` gives
// a loader (src/lib/core/wasm/define-wasm-module.ts) for a module listed in
// wasm-modules.json. The plugin emits the module's `_bg.wasm` as an asset,
// hands its URL to the glue, and fails loudly when the package isn't built.
//
// Types: src/lib/core/wasm/generated/ holds a copy of each package's
// wasm-bindgen `.d.ts` and a `declare module 'wasm:<name>'` file written from
// the manifest. They are checked in so that type checking needs no wasm build;
// a production build fails when a copy differs from the package it bundles,
// and the dev server and Vitest rewrite the copies.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { type Plugin, parseAst } from 'vite';
import {
  readWasmManifest,
  WASM_MANIFEST_PATH,
  type WasmModule,
} from './wasm-manifest.ts';

const APP_ROOT = join(import.meta.dirname, '..');
const RUNTIME_PATH = join(APP_ROOT, 'src/lib/core/wasm/define-wasm-module.ts');
export const WASM_DECLARATIONS_DIR = join(
  APP_ROOT,
  'src/lib/core/wasm/generated'
);
const WASM_PREFIX = 'wasm:';
const RESOLVED_PREFIX = '\0wasm:';
const GLUE_QUERY = '?wasm-glue';
const MODULES_DECLARATION = 'modules.d.ts';

/** The files wasm-pack writes for a module, as absolute paths. */
export function wasmPackageFiles(module: WasmModule) {
  const outDir = join(APP_ROOT, module.outDir);
  return {
    glue: join(outDir, `${module.outName}.js`),
    binary: join(outDir, `${module.outName}_bg.wasm`),
    declaration: join(outDir, `${module.outName}.d.ts`),
  };
}

export function missingWasmPackageMessage(module: WasmModule): string {
  const glue = relative(APP_ROOT, wasmPackageFiles(module).glue);
  return `The ${module.name} wasm package is not built (no apps/web/${glue}). Run \`just ensure-wasm ${module.name}\` in apps/web.`;
}

/** The checked-in `declare module 'wasm:<name>'` file for every manifest module. */
export function wasmModuleDeclarations(modules: WasmModule[]): string {
  const blocks = modules.map(
    (module) => `declare module 'wasm:${module.name}' {
  import type { WasmModule } from '@core/wasm/define-wasm-module';

  const module: WasmModule<typeof import('@core/wasm/generated/${module.name}')>;
  export default module;
}
`
  );
  return `// Generated from apps/web/wasm-modules.json by scripts/wasm-modules.ts; do not edit.\n\n${blocks.join('\n')}`;
}

/** The checked-in copy of a module's wasm-bindgen declarations. */
export function wasmDeclarationCopyPath(module: WasmModule): string {
  return join(WASM_DECLARATIONS_DIR, `${module.name}.d.ts`);
}

/**
 * Wraps wasm-bindgen glue in `instantiateGlue(binaryUrl)`, so every call
 * makes a fresh copy of the glue's state (its instance, memory views and
 * finalizers): `discard()` needs one after a trap. The glue's default binary
 * URL, `new URL('<outName>_bg.wasm', import.meta.url)`, becomes `binaryUrl`.
 */
export function wrapWasmGlue(code: string, module: WasmModule): string {
  const defaultUrl = `new URL('${module.outName}_bg.wasm', import.meta.url)`;
  if (code.split(defaultUrl).length !== 2) {
    throw new Error(
      `${module.name}: expected the glue to name its binary once as ${defaultUrl}; the wasm-bindgen output changed`
    );
  }

  const imports: string[] = [];
  const exported: string[] = [];
  // Source ranges to cut out of the body, in order.
  const cuts: Array<{ start: number; end: number }> = [];

  for (const statement of parseAst(code).body) {
    if (statement.type === 'ImportDeclaration') {
      imports.push(code.slice(statement.start, statement.end));
      cuts.push({ start: statement.start, end: statement.end });
      continue;
    }
    if (statement.type !== 'ExportNamedDeclaration') {
      if (statement.type.startsWith('Export')) {
        throw new Error(
          `${module.name}: unexpected ${statement.type} in the wasm-bindgen glue`
        );
      }
      continue;
    }
    if (statement.source) {
      throw new Error(
        `${module.name}: unexpected re-export in the wasm-bindgen glue`
      );
    }

    const declaration = statement.declaration;
    if (declaration) {
      // `export function read` becomes `function read`.
      cuts.push({ start: statement.start, end: declaration.start });
      if (declaration.type === 'VariableDeclaration') {
        for (const declarator of declaration.declarations) {
          if (declarator.id.type !== 'Identifier') {
            throw new Error(
              `${module.name}: unexpected destructured export in the wasm-bindgen glue`
            );
          }
          exported.push(declarator.id.name);
        }
      } else if (
        (declaration.type === 'FunctionDeclaration' ||
          declaration.type === 'ClassDeclaration') &&
        declaration.id
      ) {
        exported.push(declaration.id.name);
      } else {
        throw new Error(
          `${module.name}: unexpected ${declaration.type} export in the wasm-bindgen glue`
        );
      }
      continue;
    }

    // `export { initSync, __wbg_init as default };`
    cuts.push({ start: statement.start, end: statement.end });
    for (const specifier of statement.specifiers) {
      const local = specifier.local;
      const name = specifier.exported;
      if (local.type !== 'Identifier' || name.type !== 'Identifier') {
        throw new Error(
          `${module.name}: unexpected export specifier in the wasm-bindgen glue`
        );
      }
      exported.push(
        local.name === name.name ? local.name : `${name.name}: ${local.name}`
      );
    }
  }

  let body = '';
  let position = 0;
  for (const cut of cuts) {
    body += code.slice(position, cut.start);
    position = cut.end;
  }
  body += code.slice(position);

  return `${imports.join('\n')}
export function instantiateGlue(binaryUrl) {
${body.replace(defaultUrl, 'binaryUrl')}
return { ${exported.join(', ')} };
}
`;
}

/** Writes `contents` to `path` unless it already holds them; whether it wrote. */
function writeIfChanged(path: string, contents: string): boolean {
  if (existsSync(path) && readFileSync(path, 'utf8') === contents) {
    return false;
  }
  mkdirSync(WASM_DECLARATIONS_DIR, { recursive: true });
  writeFileSync(path, contents);
  return true;
}

export function wasmModules(
  manifestPath: string = WASM_MANIFEST_PATH
): Plugin {
  let modules: WasmModule[] = [];
  // A production build fails on stale declarations; elsewhere they are rewritten.
  let production = false;
  let vitest = false;

  const find = (name: string): WasmModule | undefined =>
    modules.find((module) => module.name === name);

  return {
    name: 'wasm-modules',
    enforce: 'pre',

    configResolved(config) {
      production = config.command === 'build';
      vitest = config.mode === 'test' || process.env.VITEST !== undefined;
      modules = readWasmManifest(manifestPath);
    },

    buildStart() {
      this.addWatchFile(manifestPath);
      const path = join(WASM_DECLARATIONS_DIR, MODULES_DECLARATION);
      const declarations = wasmModuleDeclarations(modules);
      if (production) {
        if (!existsSync(path) || readFileSync(path, 'utf8') !== declarations) {
          this.error(
            `${relative(APP_ROOT, path)} is out of date with wasm-modules.json. Run \`bun scripts/wasm-types.ts\` in apps/web.`
          );
        }
        return;
      }
      writeIfChanged(path, declarations);
    },

    resolveId(source) {
      if (!source.startsWith(WASM_PREFIX)) return null;
      const name = source.slice(WASM_PREFIX.length);
      if (!find(name)) {
        this.error(
          `${source}: no module named ${name} in apps/web/wasm-modules.json`
        );
      }
      return `${RESOLVED_PREFIX}${name}`;
    },

    load(id) {
      if (id.startsWith(RESOLVED_PREFIX)) {
        const module = find(id.slice(RESOLVED_PREFIX.length));
        if (!module) return null;
        const files = wasmPackageFiles(module);
        this.addWatchFile(files.glue);
        this.addWatchFile(files.declaration);

        if (!existsSync(files.glue) || !existsSync(files.binary)) {
          const message = missingWasmPackageMessage(module);
          if (production) this.error(message);
          return `import { missingWasmModule } from ${JSON.stringify(RUNTIME_PATH)};
export default missingWasmModule(${JSON.stringify(module.name)}, ${JSON.stringify(message)});
`;
        }

        const declaration = readFileSync(files.declaration, 'utf8');
        const copy = wasmDeclarationCopyPath(module);
        if (production) {
          if (!existsSync(copy) || readFileSync(copy, 'utf8') !== declaration) {
            this.error(
              `${relative(APP_ROOT, copy)} differs from the ${module.name} package's declarations. Run \`bun scripts/wasm-types.ts\` in apps/web and commit the result.`
            );
          }
        } else {
          writeIfChanged(copy, declaration);
        }

        return `import { defineWasmModule } from ${JSON.stringify(RUNTIME_PATH)};
import binaryUrl from ${JSON.stringify(`${files.binary}?url`)};

export default defineWasmModule({
  name: ${JSON.stringify(module.name)},
  thread: ${JSON.stringify(module.thread)},
  checkThread: ${!vitest},
  binaryUrl,
  glue: () => import(${JSON.stringify(`${files.glue}${GLUE_QUERY}`)}),
});
`;
      }

      if (id.endsWith(GLUE_QUERY)) {
        const path = id.slice(0, -GLUE_QUERY.length);
        const module = modules.find(
          (listed) => wasmPackageFiles(listed).glue === path
        );
        if (!module) {
          this.error(`${path} is not the glue of a wasm-modules.json module`);
        }
        this.addWatchFile(path);
        return wrapWasmGlue(readFileSync(path, 'utf8'), module);
      }

      return null;
    },
  };
}
