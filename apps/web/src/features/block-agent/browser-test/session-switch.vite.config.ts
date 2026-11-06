import { fileURLToPath } from 'node:url';
import { mergeConfig } from 'vite';
import base from './vite.config';

const directory = fileURLToPath(new URL('.', import.meta.url));
const services = `${directory}/session-switch-services.ts`;
export default mergeConfig(base, {
  resolve: {
    alias: [
      { find: /^@service-agent-harness\/client$/, replacement: services },
      { find: /^@queries\/agent-session\/log$/, replacement: services },
      { find: /^@core\/agent-fold\/client$/, replacement: services },
    ],
  },
  optimizeDeps: {
    entries: ['session-switch.html'],
    esbuildOptions: { target: 'esnext' },
  },
});
