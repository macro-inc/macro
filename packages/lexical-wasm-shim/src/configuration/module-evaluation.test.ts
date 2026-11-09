import { spawnSync } from 'node:child_process';
import { URL as NodeURL } from 'node:url';
import { expect, test } from 'vitest';

test.each([
  '../nodes/artificial.ts',
  '../nodes/replacement/normalize.ts',
  './registered-nodes.ts',
])('pure configuration entry %s loads cold without an engine', (path) => {
  const entry = new NodeURL(path, import.meta.url).href;
  const result = spawnSync(
    'bun',
    [
      '-e',
      `
    for (const name of ['compile','compileStreaming','instantiate','instantiateStreaming']) {
      WebAssembly[name] = () => { throw new Error('unexpected engine initialization'); };
    }
    const module = await import(${JSON.stringify(entry)});
    if (module.prepareEditorRegisteredNodes) {
      const prepared = module.prepareEditorRegisteredNodes({configOmitted:true,inheritedRegistry:null});
      if ([...prepared.registeredNodes.keys()].join(',') !== 'root,text,linebreak,tab,paragraph,artificial') {
        throw new Error('incorrect actual default registry');
      }
    }
    process.stdout.write('configuration ready without engine');
  `,
    ],
    { encoding: 'utf8' }
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toBe('configuration ready without engine');
});
