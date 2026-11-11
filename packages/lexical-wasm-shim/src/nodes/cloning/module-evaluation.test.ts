import { spawnSync } from 'node:child_process';
import { URL as NodeURL } from 'node:url';
import { expect, test } from 'vitest';

test('clone algorithms load without constructing a model or binding a writable stage', () => {
  const entry = new NodeURL('./index.ts', import.meta.url).href;
  const run = spawnSync(
    'bun',
    [
      '-e',
      `
    for (const name of ['compile','compileStreaming','instantiate','instantiateStreaming']) {
      WebAssembly[name] = () => { throw new Error('unexpected engine initialization'); };
    }
    const cloning = await import(${JSON.stringify(entry)});
    if (typeof cloning.afterCloneBase !== 'function' ||
        typeof cloning.afterCloneElementFields !== 'function' ||
        typeof cloning.afterCloneTextFields !== 'function' ||
        typeof cloning.resetStateOnCopy !== 'function') throw new Error('missing clone algorithms');
    try { cloning.getCloneRuntime(); throw new Error('unexpected stage binding'); }
    catch (error) {
      if (!(error instanceof Error) || error.message !== 'Actual native clone-stage runtime has not been bound') throw error;
    }
    process.stdout.write('clone algorithms ready without a stage');
  `,
    ],
    { encoding: 'utf8' }
  );
  expect(run.error).toBeUndefined();
  expect(run.status, run.stderr).toBe(0);
  expect(run.stdout).toBe('clone algorithms ready without a stage');
});
