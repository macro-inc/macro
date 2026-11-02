import { fileURLToPath } from 'node:url';
import { mergeConfig } from 'vite';
import base from './vite.config';

const directory = fileURLToPath(new URL('.', import.meta.url));
export default mergeConfig(base, {
  resolve: {
    alias: [
      // Exercise real media components without eagerly loading every app block.
      {
        find: '@core/constant/allBlocks',
        replacement: `${directory}/attachment-blocks.ts`,
      },
      { find: 'loro-crdt', replacement: 'loro-crdt/base64' },
    ],
  },
  optimizeDeps: {
    entries: ['attachments.html'],
    esbuildOptions: { target: 'esnext' },
  },
});
