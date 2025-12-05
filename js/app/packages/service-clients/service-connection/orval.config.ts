import { defineConfig } from 'orval';

export default defineConfig({
  connectionGateway: {
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
