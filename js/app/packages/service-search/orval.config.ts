import { defineConfig } from 'orval';

export default defineConfig({
  searchService: {
    output: {
      client: 'fetch',
      target: './generated/client.ts',
      schemas: './generated/models',
    },
    input: {
      target: './openapi.json',
    },
  },
});
