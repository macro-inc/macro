/**
 * Copy `packages/lexical-core/sdk.ts` and every local file it imports into
 * `src/vendor/lexical-core/`, the source of `@macro-inc/sdk/lexical`.
 *
 * Usage: bun scripts/vendor.ts [--check]
 * With `--check`, write nothing and fail when the copy is stale.
 */

import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const sourceRoot = resolve(packageRoot, '../lexical-core');
export const vendorRoot = join(packageRoot, 'src/vendor/lexical-core');
const entry = 'sdk.ts';

const header = (path: string) =>
  `// Vendored from packages/lexical-core/${path} by \`bun run vendor\`; edit the source, not this copy.\n`;

const importPattern =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;

function resolveLocal(importer: string, specifier: string): string {
  const base = resolve(dirname(importer), specifier);
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
  ]) {
    if (/\.tsx?$/.test(candidate) && existsSync(candidate)) return candidate;
  }
  throw new Error(
    `${relative(sourceRoot, importer)} imports ${specifier}, which is not a TypeScript file`,
  );
}

/** The vendored files keyed by path relative to the package, with contents. */
export async function vendoredFiles(): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const pending = [join(sourceRoot, entry)];
  while (pending.length > 0) {
    const file = pending.pop() as string;
    const path = relative(sourceRoot, file);
    if (files.has(path)) continue;
    const source = await readFile(file, 'utf8');
    files.set(path, header(path) + source);
    for (const [, specifier] of source.matchAll(importPattern)) {
      if (specifier.startsWith('.'))
        pending.push(resolveLocal(file, specifier));
    }
  }
  return files;
}

async function existingFiles(directory: string): Promise<string[]> {
  if (!existsSync(directory)) return [];
  const entries = await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  });
  return entries
    .filter((item) => item.isFile())
    .map((item) => relative(vendorRoot, join(item.parentPath, item.name)));
}

/** The paths whose vendored copy is missing, stale or no longer imported. */
export async function staleVendoredFiles(): Promise<string[]> {
  const wanted = await vendoredFiles();
  const stale: string[] = [];
  for (const [path, contents] of wanted) {
    const target = join(vendorRoot, path);
    if (!existsSync(target) || (await readFile(target, 'utf8')) !== contents)
      stale.push(path);
  }
  for (const path of await existingFiles(vendorRoot)) {
    if (!wanted.has(path)) stale.push(path);
  }
  return stale.sort();
}

if (import.meta.main) {
  if (Bun.argv.includes('--check')) {
    const stale = await staleVendoredFiles();
    if (stale.length > 0) {
      console.error(
        `src/vendor/lexical-core is stale; run \`bun run vendor\`:\n${stale.join('\n')}`,
      );
      process.exit(1);
    }
  } else {
    const files = await vendoredFiles();
    await rm(vendorRoot, { recursive: true, force: true });
    for (const [path, contents] of files) {
      const target = join(vendorRoot, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, contents);
    }
    console.log(`Vendored ${files.size} files into src/vendor/lexical-core.`);
  }
}
