import { resolve } from 'node:path';
import { loadConfigFromFile } from 'vite';
import {
  defineConfig,
  type TestProjectInlineConfiguration,
} from 'vitest/config';
import { oracleCases } from './oracle-cases';

export default defineConfig(async () => {
  const source = process.env.LEXICAL_NODES_UPSTREAM_ROOT;
  const nativeConfig = process.env.LEXICAL_NODES_NATIVE_CONFIG;
  if (!source || !nativeConfig) {
    throw new Error(
      'Node acceptance requires LEXICAL_NODES_UPSTREAM_ROOT and LEXICAL_NODES_NATIVE_CONFIG; no upstream-model fallback'
    );
  }
  const loaded = await loadConfigFromFile(
    { command: 'serve', mode: 'test' },
    resolve(nativeConfig),
    source
  );
  if (!loaded) throw new Error('Native node oracle config was not loaded');
  const original = loaded.config;
  const unit = original.test?.projects?.find(
    (project): project is TestProjectInlineConfiguration =>
      typeof project === 'object' &&
      project !== null &&
      'test' in project &&
      project.test?.name === 'unit'
  );
  if (!unit)
    throw new Error(
      'Native node oracle must preserve the original unit project'
    );
  return {
    ...original,
    root: source,
    test: {
      ...original.test,
      retry: 0,
      maxWorkers: 1,
      passWithNoTests: false,
      update: false,
      projects: [
        {
          ...unit,
          test: { ...unit.test, include: oracleCases.map((spec) => spec.file) },
        },
      ],
    },
  };
});
