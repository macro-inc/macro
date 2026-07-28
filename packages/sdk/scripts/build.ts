import { Glob } from 'bun';
import { build } from 'esbuild';

const generatedEntries = [...new Glob('generated/*/index.ts').scanSync('.')];

await build({
  entryPoints: ['src/macro.ts', ...generatedEntries],
  bundle: true,
  format: 'esm',
  splitting: true,
  outdir: 'dist',
  outbase: '.',
  platform: 'neutral',
  target: 'node18',
  // No third-party runtime deps; only Node builtins are imported.
  external: ['node:*'],
});
