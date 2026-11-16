import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: process.env.SYNC_RECORD === '1' ? ['./tests/transcript_seed.ts'] : [],
  },
});
