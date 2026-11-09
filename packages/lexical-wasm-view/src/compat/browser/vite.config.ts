import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { compatSourcePlugin, upstreamAliases } from '../upstream-harness';

const upstream = process.env.COMPAT_BASELINE === 'upstream';
export default defineConfig({
  root: fileURLToPath(new URL('./', import.meta.url)),
  plugins: [compatSourcePlugin(upstream)],
  resolve: { alias: upstreamAliases },
  define: {
    'process.env.NODE_ENV': JSON.stringify('development'),
    __COMPAT_ADAPTER__: JSON.stringify(!upstream),
  },
  build: {
    rollupOptions: { treeshake: false },
    outDir: join(
      process.env.COMPAT_DOM_TEST_DIST ?? tmpdir(),
      `lexical-compat-dom-${upstream ? 'upstream' : 'port'}`
    ),
    emptyOutDir: true,
    minify: false,
  },
  preview: {
    host: '127.0.0.1',
    port: upstream ? 41871 : 41872,
    strictPort: true,
  },
});
