import { expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The repo's Bun (and the agent image's) may predate a built-in Temporal, and
// tests here run with the polyfill preloaded, which would hide that. A fresh
// process outside this package gets no preload: the time utility has to
// install Temporal itself.
test('the time utility works in a Bun process with no preload', async () => {
  const module = join(import.meta.dir, '..', 'index.ts');
  const child = Bun.spawn(
    [
      process.execPath,
      '-e',
      `const { milliseconds } = await import(${JSON.stringify(module)}); console.log(milliseconds('PT1H30M'));`,
    ],
    { cwd: tmpdir(), stdout: 'pipe', stderr: 'pipe' }
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(stderr).toBe('');
  expect(code).toBe(0);
  expect(stdout.trim()).toBe('5400000');
});
