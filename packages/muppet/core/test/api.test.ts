/**
 * The API agents rely on, held to `apiLevel` in package.json. `api.json` has
 * what every module the package exports exports (values and types), at every
 * level released so far:
 *
 * - The library as it is must match the entry for its `apiLevel`. Changing
 *   what it exports means a new level: raise `apiLevel` and add its entry
 *   (`UPDATE_API=1 bun test core/test/api.test.ts` writes it).
 * - The API only grows: each level has everything the one before had, since
 *   agents' code that needs a level runs on any image at or above it.
 *   A released level's entry never changes.
 */
import { expect, test } from 'bun:test';
import { join, relative } from 'node:path';
import typescript from 'typescript';
import { z } from 'zod';

const root = join(import.meta.dir, '..', '..');
const apiFile = join(root, 'api.json');
const updating = process.env.UPDATE_API === '1';

const Package = z.object({
  apiLevel: z.number().int().positive(),
  exports: z.record(z.string(), z.string()),
});
/** Module path, relative to the package, to its exported names, sorted. */
const Surface = z.record(z.string(), z.array(z.string()));
const Api = z.record(z.string(), Surface);
type Surface = z.infer<typeof Surface>;

const packageJson = Package.parse(
  JSON.parse(await Bun.file(join(root, 'package.json')).text())
);

/** Every file the package's `exports` patterns reach, tests left out. */
const exportedFiles = (): string[] => {
  const files = new Set<string>();
  // A pattern's `*` may span directories (`utilities/*` reaches
  // `utilities/macro/chat`), as package exports resolve it.
  for (const target of Object.values(packageJson.exports))
    for (const file of new Bun.Glob(
      target.replace(/^\.\//, '').replace('*', '**/*')
    ).scanSync({
      cwd: root,
    }))
      if (!file.split('/').includes('test')) files.add(join(root, file));
  return [...files].sort();
};

/** What each exported module exports, values and types, from the checker. */
const surface = (): Surface => {
  const config = typescript.getParsedCommandLineOfConfigFile(
    join(root, 'tsconfig.json'),
    {},
    {
      ...typescript.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(
          typescript.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
        );
      },
    }
  );
  if (config === undefined) throw new Error('no tsconfig');
  const files = exportedFiles();
  const program = typescript.createProgram(files, config.options);
  const checker = program.getTypeChecker();
  return Object.fromEntries(
    files.map((file) => {
      const source = program.getSourceFile(file);
      const symbol =
        source === undefined ? undefined : checker.getSymbolAtLocation(source);
      const names =
        symbol === undefined
          ? []
          : checker.getExportsOfModule(symbol).map(({ name }) => name);
      return [relative(root, file), [...names].sort()];
    })
  );
};

test("the library's API is the one its apiLevel records, and every level only grows", async () => {
  const recorded = (await Bun.file(apiFile).exists())
    ? Api.parse(JSON.parse(await Bun.file(apiFile).text()))
    : {};
  const level = packageJson.apiLevel;
  const now = surface();
  if (updating) {
    // A released level's entry never changes: a different API is a new level.
    const released = recorded[level];
    if (released !== undefined && !Bun.deepEquals(released, now))
      throw new Error(
        `level ${level} is released and the API differs from it: raise apiLevel in package.json, then run this again`
      );
    await Bun.write(
      apiFile,
      `${JSON.stringify({ ...recorded, [level]: now }, null, 2)}\n`
    );
    return;
  }
  // Levels are 1, 2, … up to apiLevel, with nothing beyond it.
  expect(
    Object.keys(recorded)
      .map(Number)
      .sort((a, b) => a - b)
  ).toEqual(Array.from({ length: level }, (_, index) => index + 1));
  expect(now).toEqual(recorded[level] ?? {});
  for (let earlier = 1; earlier < level; earlier += 1) {
    const before = recorded[earlier] ?? {};
    const after = recorded[earlier + 1] ?? {};
    for (const [module, names] of Object.entries(before))
      for (const name of names)
        expect(`${module}: ${name}`).toBe(
          (after[module] ?? []).includes(name)
            ? `${module}: ${name}`
            : `${module}: ${name} (removed at level ${earlier + 1})`
        );
  }
}, 120_000);
