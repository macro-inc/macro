import { rm } from 'node:fs/promises';
import { Glob } from 'bun';
import { build } from 'esbuild';

const generatedEntries = [...new Glob('generated/*/index.ts').scanSync('.')];

// Remove artifacts from previous builds before packing the SDK.
await rm('dist', { recursive: true, force: true });

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

// Keep runtime-specific helpers out of the core graph, including shared chunks.
// LiveKit and OpenTelemetry must resolve to the consumer's installed instances.
await build({
  entryPoints: ['src/calls/node.ts', 'src/calls/browser.ts'],
  bundle: true,
  format: 'esm',
  splitting: true,
  outdir: 'dist',
  outbase: '.',
  platform: 'neutral',
  target: 'node18',
  external: ['@livekit/rtc-node', 'livekit-client', '@opentelemetry/api'],
});
