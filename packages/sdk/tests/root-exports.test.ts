import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { Glob } from 'bun';
import ts from 'typescript';

const source = join(import.meta.dir, '../src');

// Programs name handles in their own signatures
// (`import type { Channel } from '@macro-inc/sdk'`); a class the root doesn't
// export fails the code-mode type check. Namespaces are reached through `macro`.
test('the root exports every entity handle class', async () => {
  const classes: string[] = [];
  for await (const path of new Glob('**/*.ts').scan(join(source, 'entities'))) {
    const text = await Bun.file(join(source, 'entities', path)).text();
    for (const [, name] of text.matchAll(/^export class (\w+)/gm)) {
      if (!name.endsWith('Namespace')) classes.push(name);
    }
  }
  const program = ts.createProgram([join(source, 'macro.ts')], {
    noEmit: true,
    skipLibCheck: true,
  });
  const checker = program.getTypeChecker();
  const root = program.getSourceFile(join(source, 'macro.ts'));
  if (root === undefined) throw new Error('src/macro.ts is not in the program');
  const module = checker.getSymbolAtLocation(root);
  if (module === undefined) throw new Error('src/macro.ts is not a module');
  const exported = new Set(
    checker.getExportsOfModule(module).map((symbol) => symbol.name),
  );

  expect(classes.length).toBeGreaterThan(0);
  expect(classes.filter((name) => !exported.has(name)).sort()).toEqual([]);
});
