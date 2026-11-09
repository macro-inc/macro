/// <reference types="bun" />

import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'bun';

const specifier = process.argv[2];
const facade = process.argv[3];
if (!specifier) throw new Error('A namespace specifier is required');
try {
  const directory = mkdtempSync(
    join(process.env.TMPDIR ?? tmpdir(), 'lexical-namespace-')
  );
  const entry = join(directory, 'entry.mjs');
  // Prism's language modules use its real CommonJS global initialization order.
  // Keep that dependency on the normal loader, not the Lexical core.
  symlinkSync(
    resolve(import.meta.dir, '../../../../node_modules'),
    join(directory, 'node_modules'),
    'dir'
  );
  const target =
    specifier === 'lexical' && facade
      ? facade
      : fileURLToPath(import.meta.resolve(specifier));
  writeFileSync(
    entry,
    `import * as namespace from ${JSON.stringify(target)}; export {namespace};\n`
  );
  const result = await build({
    entrypoints: [entry],
    target: 'bun',
    outdir: join(directory, 'bundle'),
    metafile: true,
    throw: false,
    minify: false,
    external: ['prismjs', 'prismjs/*'],
    define: { 'process.env.NODE_ENV': JSON.stringify('development') },
    plugins: facade
      ? [
          {
            name: 'actual-lexical-facade',
            setup(builder) {
              builder.onResolve({ filter: /^lexical$/ }, () => ({
                path: facade,
              }));
            },
          },
        ]
      : [],
  });
  if (!result.success)
    throw new Error(result.logs.map((log) => log.message).join('\n'));
  if (
    facade &&
    (!result.metafile ||
      Object.keys(result.metafile.inputs).some((path) =>
        /(?:^|\/)node_modules\/lexical\//.test(path)
      ))
  )
    throw new Error('Original core runtime leaked through the facade resolver');
  const output = result.outputs.find((file) => file.kind === 'entry-point');
  if (!output) throw new Error('Namespace bundle omitted its entry');
  const loaded: unknown = await import(output.path);
  if (loaded === null || typeof loaded !== 'object' || !('namespace' in loaded))
    throw new Error('Namespace bundle omitted its module');
  const namespace: unknown = loaded.namespace;
  if (namespace === null || typeof namespace !== 'object')
    throw new Error('Expected an actual module namespace');
  const exports = Object.fromEntries(
    Object.entries(namespace).map(([name, entry]) => {
      const value: unknown = entry;
      let kind: string = typeof value;
      let arity: number | undefined;
      if (typeof value === 'function') {
        if (/^class(?:\s|\{)/.test(Function.prototype.toString.call(value)))
          kind = 'class';
        const length: unknown = Object.getOwnPropertyDescriptor(
          value,
          'length'
        )?.value;
        if (typeof length === 'number') arity = length;
      }
      if (value === null) kind = 'null';
      return [name, { kind, arity }];
    })
  );
  console.log(
    'LEXICAL_SURFACE=' + JSON.stringify({ status: 'evaluated', exports })
  );
} catch (error) {
  console.log(
    'LEXICAL_SURFACE=' +
      JSON.stringify({
        status: 'blocked',
        error:
          error instanceof Error
            ? error.message
            : 'Non-Error namespace initialization failure',
      })
  );
  process.exitCode = 1;
}
