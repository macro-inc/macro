import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin, type UserConfig } from 'vite';
import { createAppViteConfig } from '../../../../vite.base';

const directory = fileURLToPath(new URL('.', import.meta.url));
const KNOB_ENTITY = fileURLToPath(
  new URL('../components/routine-knob-entity.tsx', import.meta.url)
);

/**
 * What an entity knob's value reads to name its item, answered from the
 * fixture's items instead of the app's previews and quick access.
 */
const ENTITY_STAND_INS: Record<string, string> = {
  '@property/hooks': `${directory}stubs/entity-display.tsx`,
  '@core/context/quickAccess': `${directory}stubs/quick-access.ts`,
  '@core/component/UserIcon': `${directory}stubs/user-icon.tsx`,
};

function entityStandIns(): Plugin {
  return {
    name: 'routine-knob-entity-stand-ins',
    enforce: 'pre',
    resolveId(source, importer) {
      if (importer !== KNOB_ENTITY) return null;
      return ENTITY_STAND_INS[source] ?? null;
    },
  };
}

// Keep browser fixture optimization independent of a running native preview.
export default defineConfig(async (environment) => {
  const base: UserConfig = await createAppViteConfig()(environment);
  return {
    ...base,
    plugins: [entityStandIns(), ...(base.plugins ?? [])],
    cacheDir: 'node_modules/.vite-routine-code-tests',
  };
});
