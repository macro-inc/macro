import { spawnSync } from 'node:child_process';
import { URL as NodeURL } from 'node:url';
import { expect, test } from 'vitest';

test.each(['./index.ts', './parse.ts', './export.ts'])(
  'serialization entry %s loads without an engine',
  (path) => {
    const entry = new NodeURL(path, import.meta.url).href;
    const result = spawnSync(
      'bun',
      [
        '-e',
        `
    for (const name of ['compile','compileStreaming','instantiate','instantiateStreaming']) {
      WebAssembly[name] = () => { throw new Error('unexpected engine initialization'); };
    }
    await import(${JSON.stringify(entry)});
    process.stdout.write('JSON ready without engine');
  `,
      ],
      { encoding: 'utf8' }
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('JSON ready without engine');
  }
);
