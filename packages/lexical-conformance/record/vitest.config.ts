import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const upstreamPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../target/lexical-upstream'
);
const upstream = (await import(path.join(upstreamPath, 'vitest.config.mts')))
  .default;
export default defineConfig({
  resolve: upstream.resolve,
  test: {
    include: process.env.LEXICAL_REPLAY_ONLY
      ? ['record/replay.test.ts']
      : ['record/__tests__/*.test.ts'],
    environment: process.env.LEXICAL_REPLAY_ONLY ? 'jsdom' : 'node',
    maxWorkers: 1,
    setupFiles: process.env.LEXICAL_REPLAY_ONLY
      ? [path.join(upstreamPath, 'vitest.setup.mts')]
      : [],
    env: { LEXICAL_VERSION: JSON.stringify('0.45.0+git') },
  },
});
