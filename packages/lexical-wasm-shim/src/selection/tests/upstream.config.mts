import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfigFromFile } from 'vite';
import {
  defineConfig,
  type TestProjectInlineConfiguration,
} from 'vitest/config';
import { compatSourcePlugin } from '../../../../lexical-wasm-view/src/compat/upstream-harness';
import { oracleCases } from './oracle-cases';

export default defineConfig(async () => {
  const source = process.env.LEXICAL_SELECTION_UPSTREAM_ROOT;
  if (!source) throw new Error('LEXICAL_SELECTION_UPSTREAM_ROOT is required');
  const engine =
    process.env.LEXICAL_SELECTION_ENGINE ?? 'portDOM+upstreammodel';
  if (engine !== 'portDOM+upstreammodel' && engine !== 'actual-native') {
    throw new Error('Unknown selection oracle engine');
  }
  const native = engine === 'actual-native';
  const nativeConfig = process.env.LEXICAL_SELECTION_NATIVE_CONFIG;
  if (native && !nativeConfig) {
    throw new Error(
      'actual-native requires LEXICAL_SELECTION_NATIVE_CONFIG; no source-model fallback'
    );
  }
  const config = await loadConfigFromFile(
    { command: 'serve', mode: 'test' },
    native ? nativeConfig : resolve(source, 'vitest.config.mts'),
    source
  );
  if (!config)
    throw new Error('Selection oracle base config could not be loaded');
  const original = config.config;
  const unit = original.test?.projects?.find(
    (project): project is TestProjectInlineConfiguration =>
      typeof project === 'object' &&
      project !== null &&
      'test' in project &&
      project.test?.name === 'unit'
  );
  if (!unit)
    throw new Error('Base config must preserve the original unit project');
  const setup = unit.test?.setupFiles ?? [];
  const setupFiles = typeof setup === 'string' ? [setup] : setup;
  const aliases = original.resolve?.alias ?? [];
  const sourceAliases = Array.isArray(aliases)
    ? aliases
    : Object.entries(aliases).map(([find, replacement]) => ({
        find,
        replacement,
      }));
  const repository = fileURLToPath(new URL('../../../../../', import.meta.url));
  const compat = fileURLToPath(
    new URL('../../../../lexical-wasm-view/src/compat/', import.meta.url)
  );
  return {
    ...original,
    root: source,
    server: {
      ...original.server,
      fs: {
        ...original.server?.fs,
        allow: [source, repository, ...(original.server?.fs?.allow ?? [])],
      },
    },
    plugins: [
      ...(original.plugins ?? []),
      ...(native
        ? []
        : [compatSourcePlugin(false, resolve(source, 'packages/lexical/src'))]),
    ],
    resolve: {
      ...original.resolve,
      alias: native
        ? sourceAliases
        : [
            {
              find: /^@upstream\/(.*)$/,
              replacement: `${source}/packages/lexical/src/$1.ts`,
            },
            ...sourceAliases,
          ],
    },
    test: {
      ...original.test,
      retry: 0,
      maxWorkers: 1,
      passWithNoTests: false,
      update: false,
      projects: [
        {
          ...unit,
          test: {
            ...unit.test,
            include: oracleCases.map((spec) => spec.file),
            setupFiles: native
              ? setupFiles
              : [...setupFiles, `${compat}/test-setup.ts`],
          },
        },
      ],
    },
  };
});
