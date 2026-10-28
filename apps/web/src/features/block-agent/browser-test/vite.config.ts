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
  server: { host: '127.0.0.1', strictPort: true },
});
