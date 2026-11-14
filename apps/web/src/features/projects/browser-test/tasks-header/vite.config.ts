import { fileURLToPath } from 'node:url';
import tailwind from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import tsconfigPaths from 'vite-tsconfig-paths';

const directory = fileURLToPath(new URL('.', import.meta.url));
const webDirectory = fileURLToPath(new URL('../../../../../', import.meta.url));
const workspaceDirectory = fileURLToPath(
  new URL('../../../../../../../', import.meta.url)
);
const stubs = `${directory}/stubs.tsx`;

export default defineConfig({
  root: directory,
  cacheDir: `${directory}/.vite`,
  plugins: [
    solidPlugin(),
    solidSvg({ defaultAsComponent: true }),
    tsconfigPaths({ projects: [`${webDirectory}/tsconfig.json`] }),
    tailwind(),
  ],
  resolve: {
    dedupe: ['solid-js'],
    alias: [
      { find: 'loro-crdt', replacement: 'loro-crdt/base64' },
      {
        find: '@app/features/tasks-view/tasks-view-context',
        replacement: stubs,
      },
      { find: '@app/features/tasks-view/tasks-content', replacement: stubs },
      {
        find: '@app/features/tasks-view/components/TasksControls',
        replacement: stubs,
      },
      { find: '../queries/project-tasks', replacement: stubs },
      {
        find: '@property/editors/selectors/PropertyEntitySelector',
        replacement: stubs,
      },
    ],
  },
  optimizeDeps: { rolldownOptions: { transform: { target: 'esnext' } } },
  server: {
    host: '127.0.0.1',
    strictPort: true,
    fs: { allow: [workspaceDirectory] },
  },
});
