import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  cacheDir: fileURLToPath(
    new URL('../node_modules/.vite/browser-test', import.meta.url)
  ),
  server: { host: '127.0.0.1' },
});
