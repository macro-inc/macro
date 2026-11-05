import { Glob } from 'bun';
import { build } from 'esbuild';

const generatedEntries = [...new Glob('generated/*/index.ts').scanSync('.')];

await build({
  entryPoints: ['src/macro.ts', 'src/lexical.ts', ...generatedEntries],
  bundle: true,
  format: 'esm',
  splitting: true,
  outdir: 'dist',
  outbase: '.',
  platform: 'neutral',
  target: 'node18',
  // Lexical is an optional peer, and `Document.lexical()` imports
  // `@macro-inc/sdk/lexical` by name, so a program's own `lexical` import is
  // the same module instance. Its own dependencies stay imports so each
  // runtime resolves its variant (nanoid's browser build has no node:crypto).
  external: [
    'node:*',
    'lexical',
    '@lexical/*',
    '@macro-inc/sdk/lexical',
    'linkify-it',
    'nanoid',
  ],
});
