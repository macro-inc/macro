import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { createAppViteConfig } from '../../../../../../../vite.base';

const directory = new URL('.', import.meta.url);

export default defineConfig(async (env) => {
  const app = await createAppViteConfig()(env);
  return {
    ...app,
    server: { ...app.server, hmr: false, proxy: undefined },
    plugins: [
      {
        name: 'synthetic-canvas-preview-boundaries',
        enforce: 'pre',
        transform(code: string, id: string) {
          if (id.endsWith('/core/constant/allBlocks.ts')) {
            // The isolated preview does not need to eagerly load every feature
            // definition. Keep the registry helpers used by DocumentCard.
            return code.replace(
              /Object\.values<AnyBlockDefinition>\([\s\S]*?\n\);/,
              'BlockRegistry.map((name) => ({ name, accepted: { [name]: null } }))'
            );
          }
          if (id.endsWith('/component/decorator/DocumentCard.tsx')) {
            return code.replace(
              "from '@core/orchestrator'",
              `from '${fileURLToPath(new URL('canvas-viewport-preview.tsx', directory))}'`
            );
          }
          if (id.endsWith('/block-canvas/canvas-next-document.tsx')) {
            return code.replace(
              "from './queries/canvas-sync'",
              `from '${fileURLToPath(new URL('canvas-viewport-synthetic-source.ts', directory))}'`
            );
          }
        },
      },
      ...(app.plugins ?? []),
    ],
  };
});
