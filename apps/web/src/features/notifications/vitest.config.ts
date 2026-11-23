import solidPlugin from 'vite-plugin-solid';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';
import { wasmModules } from '../../../scripts/wasm-modules.ts';

export default defineConfig({
  plugins: [wasmModules(), tsconfigPaths(), solidPlugin()],
  test: {
    environment: 'jsdom',
    globals: true,
  },
} as any);
