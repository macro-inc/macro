import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import solid from 'vite-plugin-solid';
import tsconfigPaths from 'vite-tsconfig-paths';

const directory = fileURLToPath(new URL('.', import.meta.url));
const webDirectory = fileURLToPath(new URL('../../../../../', import.meta.url));

/** Swaps what renders inside a pane and a block for local stand-ins. */
const STAND_INS: { importer: string; source: string; file: string }[] = [
  {
    importer: 'split-layout/SplitLayout.tsx',
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
    name: 'desktop-tabs-stand-ins',
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

export default defineConfig({
  root: directory,
  plugins: [
    standIns(),
    solid(),
    tsconfigPaths({ projects: [`${webDirectory}/tsconfig.json`] }),
  ],
  resolve: { dedupe: ['solid-js'] },
  server: { host: '127.0.0.1', strictPort: true },
});
