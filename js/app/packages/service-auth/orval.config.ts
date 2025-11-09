import { defineConfig } from 'orval';

export default defineConfig({
  authService: {
    output: {
      client: 'fetch',
      target: './generated/client.ts',
      schemas: './generated/schemas',
    },
    input: {
      target: './openapi.json',
    },
  },
});
