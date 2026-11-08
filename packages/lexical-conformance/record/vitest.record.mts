import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { membranePlugin } from './resolver';

const root = process.env.LEXICAL_UPSTREAM;
if (!root) throw new Error('Run through just lexical-fixtures');
const upstream = (await import(path.join(root, 'vitest.config.mts'))).default;
const record = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  ...upstream,
  resolve: {
    ...upstream.resolve,
    alias: [
      ...upstream.resolve.alias,
      { find: /^loro-crdt$/, replacement: path.resolve(record, '../node_modules/loro-crdt/nodejs/index.js') },
      { find: '@loro-mirror/core', replacement: path.resolve(root, 'packages/loro-mirror/src/index.ts') },
      { find: /^nanoid$/, replacement: path.resolve(record, '../node_modules/nanoid/index.browser.js') },
    ],
  },
  root,
  plugins: [membranePlugin()],
  test: {
    ...upstream.test,
    projects: [
      {
      ...upstream.test.projects[0],
      extends: true,
      test: {
        name: 'record', environment: 'jsdom',
        include: process.env.LEXICAL_MACRO === '1' ? ['packages/lexical-core/tests/**/*.test.ts'] : ['packages/**/__tests__/unit/**/*.test{.ts,.tsx,.js,.jsx}'],
        setupFiles: [path.join(record, 'bootstrap.ts'), path.join(root, 'vitest.setup.mts'), path.join(record, 'setup.ts')],
        env: { LEXICAL_VERSION: JSON.stringify('0.45.0+git'), NODE_ENV: 'development' },
      },
      },
    ],
    maxWorkers: 2,
    // Inlined functions can disappear from V8's per-test coverage samples.
    pool: 'forks',
    execArgv: ['--no-opt', '--no-maglev'],
    maxConcurrency: 1, fileParallelism: true,
    reporters: ['default', path.join(record, 'reporter.ts')],
    sequence: { hooks: 'stack' },
  },
});
