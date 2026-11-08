import { expect, test } from 'vitest';
import { build } from 'vite';
import solid from 'vite-plugin-solid';

test('production entry excludes legacy model modules and splits lazy HTML and Prism', async () => {
  const modules: string[] = [];
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [
      solid(),
      {
        name: 'production-model-boundary',
        moduleParsed(info) {
          modules.push(info.id);
          if (
            /node_modules\/(lexical|@lexical\/[^/]+)\//.test(info.id) ||
            /lexical-wasm-shim/.test(info.id)
          )
            throw new Error('Legacy model in production graph: ' + info.id);
        },
      },
    ],
    build: {
      write: false,
      target: 'esnext',
      minify: false,
      lib: {
        entry: new URL('./index.ts', import.meta.url).pathname,
        formats: ['es'],
      },
    },
  });
  const output = (Array.isArray(result) ? result : [result]).flatMap(
    (build) => {
      if (!('output' in build))
        throw new Error('Unexpected production watcher');
      return build.output;
    }
  );
  const entry = output.find((chunk) => chunk.type === 'chunk' && chunk.isEntry);
  if (!entry || entry.type !== 'chunk')
    throw new Error('Missing production entry');
  expect(entry.imports).not.toContain('prismjs');
  expect(modules.length).toBeGreaterThan(20);
  expect(
    Object.keys(entry.modules).some((id) =>
      /html-import|code-highlight|prismjs/.test(id)
    )
  ).toBe(false);
  expect(
    output.some(
      (chunk) =>
        chunk.type === 'chunk' &&
        Object.keys(chunk.modules).some((id) =>
          id.endsWith('/view/html-import.ts')
        )
    )
  ).toBe(true);
  expect(
    output.some(
      (chunk) =>
        chunk.type === 'chunk' &&
        Object.keys(chunk.modules).some((id) =>
          id.endsWith('/view/code-highlight.ts')
        )
    )
  ).toBe(true);
});
