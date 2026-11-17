import { rm } from 'node:fs/promises';
import { Glob } from 'bun';
import { build } from 'esbuild';

const generatedEntries = [...new Glob('generated/*/index.ts').scanSync('.')];

// Remove artifacts from previous builds before packing the SDK.
await rm('dist', { recursive: true, force: true });

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
