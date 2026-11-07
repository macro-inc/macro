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
  root,
  plugins: [membranePlugin()],
  test: {
    ...upstream.test,
    projects: [{
      ...upstream.test.projects[0],
      extends: true,
      test: {
        name: 'record', environment: 'jsdom',
        include: ['packages/**/__tests__/unit/**/*.test{.ts,.tsx,.js,.jsx}'],
        setupFiles: [path.join(root, 'vitest.setup.mts'), path.join(record, 'setup.ts')],
        env: { LEXICAL_VERSION: JSON.stringify('0.45.0+git'), NODE_ENV: 'development' },
      },
    }],
    maxWorkers: 2,
    maxConcurrency: 1, fileParallelism: false,
    reporters: ['default', path.join(record, 'reporter.ts')],
    sequence: { hooks: 'stack' },
  },
});
