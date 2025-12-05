import { defineConfig } from 'orval';

export default defineConfig({
  notificationService: {
    output: {
      client: 'fetch',
      target: './generated/client.ts',
      schemas: './generated/schemas',
      override: {},
    },
    input: {
      target: './openapi.json',
    },
  },
});
