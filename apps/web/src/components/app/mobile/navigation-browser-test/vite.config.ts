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

/** Swaps what renders inside a pane and a block for local stand-ins. */
const STAND_INS: { importer: string; source: string; file: string }[] = [
  {
    importer: 'split-layout/mobile/MobileSplitContainer.tsx',
    source: 'components/SplitPanel',
    file: 'split-panel.tsx',
  },
  {
    importer: 'core/orchestrator.tsx',
    source: 'internal/BlockLoader',
    file: 'block-loader.tsx',
  },
  {
    importer: 'core/orchestrator.tsx',
    source: 'internal/BlockEffectRunner',
    file: 'block-effect-runner.tsx',
  },
];

function standIns(): Plugin {
  return {
    name: 'sheet-navigation-stand-ins',
    enforce: 'pre',
    resolveId(source, importer) {
      const standIn = STAND_INS.find(
        (candidate) =>
          source.endsWith(candidate.source) &&
          importer?.endsWith(candidate.importer)
      );
      return standIn ? `${directory}stand-ins/${standIn.file}` : undefined;
    },
  };
}

/** Real phone panes and sheets, navigated by a simulated notification tap, with no services behind them. */
export default defineConfig({
  root: directory,
  cacheDir: `${directory}/.vite`,
  plugins: [
    standIns(),
    solidPlugin(),
    solidSvg({ defaultAsComponent: true }),
    tsconfigPaths({ projects: [`${webDirectory}/tsconfig.json`] }),
    tailwind(),
  ],
  resolve: {
    dedupe: ['solid-js'],
    alias: { 'loro-crdt': 'loro-crdt/base64' },
  },
  optimizeDeps: { rolldownOptions: { transform: { target: 'esnext' } } },
  server: {
    host: '127.0.0.1',
    strictPort: true,
    fs: { allow: [workspaceDirectory] },
  },
});
