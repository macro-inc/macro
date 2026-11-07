import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'vitest';
import { modules } from './membrane';
import { replay } from './replay-js';
import type { Fixture } from './schema';

const root =
  process.env.LEXICAL_UPSTREAM ?? path.resolve('../../target/lexical-upstream');
const directory = process.env.LEXICAL_FIXTURES ?? path.resolve('fixtures');
const aliases = JSON.parse(
  readFileSync(path.join(root, 'tsconfig.test.json'), 'utf8')
).compilerOptions.paths as Record<string, string[]>;
async function load(name: string): Promise<Record<string, unknown>> {
  let relative: string | undefined = aliases[name]?.[0];
  if (name.startsWith('@macro-inc/lexical-core/')) {
    const prefix =
      'packages/lexical-core/' + name.slice('@macro-inc/lexical-core/'.length);
    relative = ['.ts', '.tsx', '/index.ts']
      .map((suffix) => prefix + suffix)
      .find((file) => existsSync(path.join(root, file)));
  }
  if (!relative) {
    const canonical = name.match(/^@lexical\/([^/]+)\/(.+)$/);
    if (canonical) {
      const prefix = `packages/lexical-${canonical[1]}/src/${canonical[2]}`;
      relative = ['.ts', '.tsx', '/index.ts', '/index.tsx']
        .map((suffix) => prefix + suffix)
        .find((file) => existsSync(path.join(root, file)));
    }
  }
  if (!relative) {
    const parent = Object.keys(aliases)
      .filter((alias) => name.startsWith(`${alias}/`))
      .sort((a, b) => b.length - a.length)[0];
    if (parent) {
      const prefix = path.join(
        path.dirname(aliases[parent][0]),
        name.slice(parent.length + 1)
      );
      relative = ['.ts', '.tsx', '/index.ts', '/index.tsx']
        .map((suffix) => prefix + suffix)
        .find((candidate) => existsSync(path.join(root, candidate)));
    }
  }
  if (!relative) throw new Error(`Unknown fixture module: ${name}`);
  const module = await import(/* @vite-ignore */ path.join(root, relative));
  modules.set(name, module);
  return module;
}
await load('lexical');
const utils = await load('lexical/LexicalUtils');
await load('lexical/__tests__/utils');
if (process.env.LEXICAL_MACRO === '1')
  await load('@macro-inc/lexical-core/node-list');
const reset = utils.resetRandomKey;
if (typeof reset !== 'function') throw new Error('Missing resetRandomKey');
const index: { id: string; file: string | null; apis: string[] }[] = JSON.parse(
  readFileSync(path.join(directory, 'index.json'), 'utf8')
);
for (const name of new Set(
  index
    .filter(
      (row) =>
        row.file &&
        row.id.startsWith('lexical-core/') ===
          (process.env.LEXICAL_MACRO === '1')
    )
    .flatMap((row) => row.apis)
    .map((api) => api.slice(0, api.indexOf('.')))
    .filter(
      (name) =>
        name.startsWith('lexical') ||
        name.startsWith('@lexical/') ||
        name.startsWith('@macro-inc/lexical-core/')
    )
)) {
  if (!modules.has(name)) await load(name);
}
// Node classes in editor configs need their packages even when no call names them.
for (const name of [
  '@lexical/code',
  '@lexical/headless',
  '@lexical/hashtag',
  '@lexical/link',
  '@lexical/list',
  '@lexical/mark',
  '@lexical/overflow',
  '@lexical/rich-text',
  '@lexical/table',
]) {
  if (!modules.has(name)) await load(name);
}
for (const row of index) {
  if (!row.file) continue;
  if (
    row.id.startsWith('lexical-core/') !==
    (process.env.LEXICAL_MACRO === '1')
  )
    continue;
  const recorded: Fixture = JSON.parse(
    readFileSync(path.join(directory, row.file), 'utf8')
  );
  test(row.id, async () => {
    await replay(recorded, () => reset());
  });
}
