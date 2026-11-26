import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vite';
import solid from 'vite-plugin-solid';
import base from './vite.config.ts';

const directory = fileURLToPath(new URL('.', import.meta.url));

/** Production build of the cache engine benchmark page alone (`bench-runner.ts`). */
export default defineConfig((env) => {
  const config = base(env);
  return mergeConfig(
    { ...config, build: { ...config.build, rolldownOptions: undefined } },
    {
      // Telemetry imports reach `.tsx` modules; compile them as the app does.
      plugins: [solid()],
      build: {
        outDir: resolve(directory, '.dist-bench'),
        sourcemap: false,
        rolldownOptions: { input: { bench: resolve(directory, 'bench.html') } },
      },
    }
  );
});
