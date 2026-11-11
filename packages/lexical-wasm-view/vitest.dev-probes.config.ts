import { defineConfig } from 'vitest/config';

// Runs only against a dev-probes document_session_wasm build named by DEV_PROBES_WASM_DIR.
export default defineConfig({
  test: {
    include: ['src/**/*.dev-probes.ts'],
  },
});
