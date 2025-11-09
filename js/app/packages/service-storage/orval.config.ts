import { defineConfig } from 'orval';

export default defineConfig({
  cloudstorage: {
    output: {
      client: 'zod',
      mode: 'split',
      target: './generated/zod.ts',
      schemas: './generated/schemas',
      biome: true,
    },
    input: {
      target: './openapi.json',
    },
  },
});
