/**
 * Copy the workspace sources the SDK bundles into `src/vendor/`. The SDK is a
 * standalone package, so it cannot depend on workspace packages; vendoring
 * keeps one source of truth while users install no extra dependencies.
 * `--check` fails when a copy is stale.
 */
import * as path from 'node:path';

const packagesDirectory = path.resolve(import.meta.dirname, '../..');
const vendorDirectory = path.resolve(import.meta.dirname, '../src/vendor');

/** Source files, relative to `packages/`; each lands at the same path under `src/vendor/`. */
const files = [
  'editor-ops/src/document/index.ts',
  'editor-ops/src/document/document-editor.ts',
  'editor-ops/src/document/errors.ts',
  'editor-ops/src/document/ops.ts',
  'lexical-core/nodes/databaseQueryData.ts',
  'lexical-core/utils/html-entities.ts',
];

/** Package imports the vendored files use, mapped to their vendored location. */
const packageImports: Record<string, string> = {
  '@macro-inc/lexical-core/nodes/databaseQueryData':
    'lexical-core/nodes/databaseQueryData',
};

function rewriteImports(source: string, file: string): string {
  return source.replace(/from '(@macro-inc\/[^']+)'/g, (_, specifier) => {
    const target = packageImports[specifier];
    if (!target) throw new Error(`${file} imports unvendored ${specifier}`);
    const relative = path.relative(path.dirname(file), target);
    return `from '${relative.startsWith('.') ? relative : `./${relative}`}'`;
  });
}

const check = process.argv.includes('--check');
const stale: string[] = [];

for (const file of files) {
  const source = await Bun.file(path.join(packagesDirectory, file)).text();
  const header = `// Vendored from packages/${file} by packages/sdk/scripts/vendor.ts; do not edit.\n`;
  const vendored = header + rewriteImports(source, file);
  const destination = path.join(vendorDirectory, file);

  if (check) {
    const current = Bun.file(destination);
    if (!(await current.exists()) || (await current.text()) !== vendored)
      stale.push(file);
    continue;
  }

  await Bun.write(destination, vendored);
}

if (stale.length > 0) {
  console.error(
    `Stale vendored files (run bun run vendor):\n${stale.join('\n')}`,
  );
  process.exit(1);
}
