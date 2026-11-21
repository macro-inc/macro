import { fileURLToPath } from 'node:url';
import tailwind from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import tsconfigPaths from 'vite-tsconfig-paths';

const directory = fileURLToPath(new URL('.', import.meta.url));
const webDirectory = fileURLToPath(new URL('../../../../../', import.meta.url));
const workspaceDirectory = fileURLToPath(
  new URL('../../../../../../../', import.meta.url)
);

// Pane loading is outside this fixture; retain the real split manager/router.
function navigationStandIns(): Plugin {
  return {
    name: 'privacy-navigation-stand-ins',
    enforce: 'pre',
    resolveId(source) {
      if (source.endsWith('componentRegistry'))
        return `${directory}/navigation-stand-ins.tsx`;
      if (
        source.endsWith('internal/BlockLoader') ||
        source.endsWith('internal/BlockEffectRunner')
      )
        return `${directory}/navigation-stand-ins.tsx`;
    },
  };
}

export default defineConfig({
  root: directory,
  cacheDir: `${directory}/.vite`,
  plugins: [
    navigationStandIns(),
    solidPlugin(),
    solidSvg({ defaultAsComponent: true }),
    tsconfigPaths({ projects: [`${webDirectory}/tsconfig.json`] }),
    tailwind(),
  ],
  resolve: {
    dedupe: ['solid-js'],
    alias: [
      ...[
        '@app/lib/analytics/posthog',
        '@queries/team/teams',
        '@core/context/user',
        '@core/component/Toast/Toast',
        '@service-storage/crm-email-privacy',
        '@service-storage/crm-access-authority',
      ].map((find) => ({
        find,
        replacement: `${directory}/preview-adapters.ts`,
      })),
      {
        find: '../context/crm-context',
        replacement: `${directory}/preview-adapters.ts`,
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
