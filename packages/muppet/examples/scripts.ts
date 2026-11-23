import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import typescript from 'typescript';
import type { Exported } from '../core/code.ts';
import type { Scripts } from '../runtimes/pieces.ts';
import { checker, loader } from '../utilities/scripts/index.ts';

const config = join(import.meta.dir, '..', 'tsconfig.json');
const scriptsDirectory = '.scripts';

/**
 * How an example's agent runs scripts: each is type-checked against the
 * example's `Script` type, then written to the example's directory only long
 * enough to import it.
 */
export const scripts = (directory: string, script: Exported): Scripts => {
  const check = checker({ typescript, config });
  return {
    load: loader({
      directory: join(directory, scriptsDirectory),
      script,
      check: async (files) => check.check(files),
      id: () => crypto.randomUUID(),
      write: async (path, text) => {
        await Bun.write(path, text);
      },
      remove: (path) => rm(path, { force: true }),
      load: (path) => import(path),
    }),
    signatures: async (file, names) => check.signatures(file, names),
    script,
  };
};
