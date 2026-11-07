import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { buildWasm, pkg } from './build-wasm';
import { prepareUpstream } from './prepare-upstream';

buildWasm();
const upstream = await prepareUpstream();
const version = JSON.parse(
  (await import('node:fs')).readFileSync(
    path.join(pkg, 'upstream.lock'),
    'utf8'
  )
).version as string;
const aliases = JSON.parse(
  (await import('node:fs')).readFileSync(
    path.join(upstream, 'tsconfig.test.json'),
    'utf8'
  )
).compilerOptions.paths as Record<string, string[]>;
export default defineConfig({
  root: pkg,
  plugins: [
    {
      name: 'production-oracle',
      enforce: 'pre',
      transform(code, id) {
        if (id.endsWith('/LexicalUpdates.ts') && id.startsWith(upstream))
          code = code.replace(
            'mutatedNodes = $reconcileRoot(',
            'globalThis.__lexDiffBeforeReconcile?.(editor, currentEditorState._nodeMap, new Map(pendingEditorState._nodeMap)); mutatedNodes = $reconcileRoot('
          );
        if (id.startsWith(upstream))
          return code
            .replaceAll("process.env.NODE_ENV !== 'production'", 'false')
            .replaceAll("process.env.NODE_ENV === 'production'", 'true');
      },
    },
  ],
  resolve: {
    alias: Object.entries(aliases).map(([name, [file]]) => ({
      find: new RegExp(
        `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*$/, '(.*)')}$`
      ),
      replacement: path.resolve(upstream, file).replace(/\*$/, '$1'),
    })),
  },
  test: {
    include: ['diff/**/*.test.ts'],
    setupFiles: [path.join(pkg, 'diff/setup.ts')],
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        userAgent: 'Mozilla/5.0 AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
      },
    },
    maxWorkers: 1,
    testTimeout: 300000,
    env: { LEXICAL_VERSION: JSON.stringify(version) },
  },
});
