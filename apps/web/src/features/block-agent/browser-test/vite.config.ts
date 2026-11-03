import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import tsconfigPaths from 'vite-tsconfig-paths';

const directory = fileURLToPath(new URL('.', import.meta.url));
const webDirectory = fileURLToPath(new URL('../../../../', import.meta.url));
export default defineConfig({
  root: directory,
  plugins: [
    {
      name: 'stub-message-document',
      enforce: 'pre',
      resolveId(source) {
        if (
          source === '../queries/create-message-document' ||
          source.endsWith('/block-agent/queries/create-message-document') ||
          source.endsWith('/block-agent/queries/create-message-document.ts')
        ) {
          return `${directory}/message-document-stub.ts`;
        }
      },
    },
    tailwindcss(),
    solid(),
    solidSvg({ defaultAsComponent: true }),
    tsconfigPaths({ projects: [`${webDirectory}/tsconfig.json`] }),
  ],
  resolve: {
    dedupe: ['solid-js'],
    alias: [
      {
        find: '../context/AgentSessionContext',
        replacement: `${directory}/session.ts`,
      },
      {
        find: '../../agent-reviews/views/persisted-review',
        replacement: `${directory}/review.tsx`,
      },
    ],
  },
  // The app target supports top-level await. This fixture's default esbuild
  // target does not, and the transcript graph reaches loro.
  esbuild: { target: 'esnext' },
  optimizeDeps: { esbuildOptions: { target: 'esnext' } },
  server: { host: '127.0.0.1', strictPort: true },
});
