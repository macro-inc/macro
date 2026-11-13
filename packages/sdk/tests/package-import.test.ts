// Module import cycles only fail for the module that happens to load first,
// and `bun test` shares one module graph across test files, so a cycle can
// pass every other test. Each import here runs in a fresh process.

import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');

function importsCleanly(path: string): { ok: boolean; output: string } {
  const result = Bun.spawnSync({
    cmd: [process.execPath, '-e', `await import(${JSON.stringify(path)});`],
    cwd: ROOT,
    env: { ...process.env, MACRO_API_KEY: 'mak_test' },
    stderr: 'pipe',
    stdout: 'pipe',
  });
  return {
    ok: result.exitCode === 0,
    output: `${result.stdout.toString()}${result.stderr.toString()}`,
  };
}

// The package entry, and the email message module whose cycle (message ->
// thread -> draft -> message) once broke it when it loaded first.
const sourceModules = ['src/macro.ts', 'src/entities/email/message.ts'];

describe('package import', () => {
  test.each(sourceModules)('%s loads on its own', (module) => {
    const { ok, output } = importsCleanly(join(ROOT, module));
    expect(output).not.toContain('before initialization');
    expect(ok).toBe(true);
  });

  const dist = join(ROOT, 'dist/src/macro.js');
  test.skipIf(!existsSync(dist))('the built entry loads', () => {
    const { ok, output } = importsCleanly(dist);
    expect(output).not.toContain('before initialization');
    expect(ok).toBe(true);
  });
});
