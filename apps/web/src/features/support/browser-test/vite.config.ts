import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
export default defineConfig({
  plugins: [solid()],
  server: { host: '0.0.0.0', port: 4177, strictPort: true },
  resolve: { dedupe: ['solid-js'] },
  optimizeDeps: { entries: ['src/features/support/browser-test/index.html'] },
});
