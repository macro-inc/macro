import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('../../../../', import.meta.url)),
  resolve: {
    alias: {
      'loro-crdt': 'loro-crdt/base64',
      '@macro-inc/lexical-core': fileURLToPath(
        new URL('../../../../packages/lexical-core', import.meta.url)
      ),
    },
  },
  plugins: [
    {
      name: 'editing-api-docs',
      async transform(source, id) {
        if (id.endsWith('.md'))
          return { code: `export default ${JSON.stringify(source)}` };
      },
    },
  ],
  test: {
    environment: 'node',
    maxWorkers: 2,
    include: ['services/ai-editing-worker/src/code-mode/**/*.test.ts'],
  },
});
