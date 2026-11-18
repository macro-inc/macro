/**
 * This code runs on the muppet its computer's image ships: it may need no
 * higher muppet API (`muppetApi` here) than that muppet has (`apiLevel`).
 * Checked against the muppet this checkout resolves, which in the monorepo
 * is the one the next image is built from.
 */
import { expect, test } from 'bun:test';
import { dirname, join } from 'node:path';
import { z } from 'zod';

const root = join(import.meta.dir, '..');
const Needs = z.object({ muppetApi: z.number().int().nonnegative() });
const Has = z.object({ apiLevel: z.number().int().nonnegative() });

test('the code needs no higher muppet API than the muppet it runs on has', async () => {
  const muppet = join(
    dirname(Bun.resolveSync('@macro-inc/muppet/core/agent', root)),
    '..',
    'package.json'
  );
  const { muppetApi } = Needs.parse(
    JSON.parse(await Bun.file(join(root, 'package.json')).text())
  );
  const { apiLevel } = Has.parse(JSON.parse(await Bun.file(muppet).text()));
  expect(muppetApi).toBeLessThanOrEqual(apiLevel);
});

/** Every `import { … } from '@macro-inc/muppet/…'` in this code, by module file and name. */
const muppetImports = async (): Promise<readonly [string, string][]> => {
  const found: [string, string][] = [];
  const statement =
    /(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'@macro-inc\/muppet\/([^']+)'/g;
  for await (const file of new Bun.Glob('**/*.ts').scan({ cwd: root })) {
    if (file.startsWith('node_modules/') || file.startsWith('.')) continue;
    const text = await Bun.file(join(root, file)).text();
    for (const [, names = '', specifier = ''] of text.matchAll(statement))
      for (const raw of names.split(',')) {
        const name = raw
          .trim()
          .replace(/^type\s+/, '')
          .split(/\s+as\s+/)[0]
          ?.trim();
        if (name !== undefined && /^[A-Za-z_$][\w$]*$/.test(name))
          found.push([specifier, name]);
      }
  }
  return found;
};

test('everything the code imports from muppet is in the API level it declares', async () => {
  const muppetRoot = join(
    dirname(Bun.resolveSync('@macro-inc/muppet/core/agent', root)),
    '..'
  );
  const { muppetApi } = Needs.parse(
    JSON.parse(await Bun.file(join(root, 'package.json')).text())
  );
  const Api = z.record(z.string(), z.record(z.string(), z.array(z.string())));
  const api = Api.parse(
    JSON.parse(await Bun.file(join(muppetRoot, 'api.json')).text())
  );
  const level = api[String(muppetApi)] ?? {};
  const missing = (await muppetImports()).filter(([specifier, name]) => {
    const module =
      level[`${specifier}.ts`] ?? level[`${specifier}/index.ts`] ?? [];
    return !module.includes(name);
  });
  expect(missing).toEqual([]);
});
