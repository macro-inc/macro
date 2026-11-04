import { fileURLToPath } from 'node:url';
import tailwind from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import tsconfigPaths from 'vite-tsconfig-paths';

const directory = fileURLToPath(new URL('.', import.meta.url));
const webDirectory = fileURLToPath(new URL('../../../../', import.meta.url));
const workspaceDirectory = fileURLToPath(
  new URL('../../../../../../', import.meta.url)
);

const previewAdapters = `${directory}/preview-adapters.tsx`;
const previewImports = [
  '@app/features/crm/crm-person',
  '@app/features/email-message/components/email-user-tooltip',
  '@app/features/email-thread/context/email-thread-state-context',
  '@app/features/email-thread/context/email-thread-view-context',
  '@components/app/split-layout/layout',
  '@core/component/UserIcon',
];

/** The real side panel and People section over a sample thread and CRM. */
export default defineConfig({
  root: directory,
  cacheDir: `${directory}/.vite`,
  plugins: [
    solidPlugin(),
    solidSvg({ defaultAsComponent: true }),
    tsconfigPaths({ projects: [`${webDirectory}/tsconfig.json`] }),
    tailwind(),
  ],
  optimizeDeps: { esbuildOptions: { target: 'esnext' } },
  resolve: {
    dedupe: ['solid-js'],
    alias: previewImports.map((find) => ({
      find,
      replacement: previewAdapters,
    })),
  },
  server: {
    host: '127.0.0.1',
    port: 3094,
    strictPort: true,
    fs: { allow: [workspaceDirectory] },
  },
});
