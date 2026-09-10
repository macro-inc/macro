// Standalone build for the marketing-site "live editor" embed. Reuses the macro
// editor source (and all of its deps + Tailwind theme) but stubs the few
// backend-coupled modules (analytics, quick-access, user) so the widget runs
// with no auth / queries / websocket. Output is written straight into the
// marketing site's public/ so it can be served as a static iframe.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwind from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import wasm from 'vite-plugin-wasm';
import tsconfigPaths from 'vite-tsconfig-paths';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const outDir = resolve(here, '../../../../solid-site/public/live-editor');

const stub = (p: string) => resolve(here, p);

export default defineConfig({
  root: here,
  base: '/live-editor/',
  plugins: [
    solid(),
    wasm(),
    tailwind(),
    solidSvg({ defaultAsComponent: true }),
    tsconfigPaths({ root: appRoot }),
  ],
  resolve: {
    alias: [
      { find: /^@core\/context\/quickAccess$/, replacement: stub('stubs/quickAccess.ts') },
      { find: /^@core\/context\/user$/, replacement: stub('stubs/user.ts') },
      { find: /^@app\/component\/analytics-context$/, replacement: stub('stubs/analyticsContext.tsx') },
      { find: /^@app\/lib\/analytics$/, replacement: stub('stubs/analytics/index.ts') },
      { find: /^@app\/lib\/analytics\/analytics$/, replacement: stub('stubs/analytics/analytics.ts') },
      { find: /^@app\/lib\/analytics\/posthog$/, replacement: stub('stubs/analytics/posthog.tsx') },
      // The embed entry/stub files live outside the macro tsconfig `include`, so
      // vite-tsconfig-paths won't map their `@core`/`@entity` imports. Map the
      // ones they use directly; package-internal imports are handled by the
      // tsconfig-paths plugin below.
      { find: /^@core\//, replacement: `${resolve(appRoot, 'packages/core')}/` },
      { find: /^@entity$/, replacement: resolve(appRoot, 'packages/entity/src/index.ts') },
      { find: /^@lexical-core$/, replacement: resolve(appRoot, '../lexical-core/index.ts') },
      { find: /^@lexical-core\//, replacement: `${resolve(appRoot, '../lexical-core')}/` },
    ],
    dedupe: ['solid-js', 'lexical', 'loro-crdt'],
  },
  define: {
    // No auth in the embed — skip profile-picture network fetches so mention
    // avatars fall back to initials cleanly.
    'import.meta.env.VITE_ENABLE_PROFILE_PICTURES': '"false"',
  },
  worker: {
    format: 'es',
  },
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'solid-js',
    supported: { 'top-level-await': true },
  },
  build: {
    outDir,
    emptyOutDir: true,
    target: 'esnext',
    sourcemap: false,
    chunkSizeWarningLimit: 6000,
  },
});
