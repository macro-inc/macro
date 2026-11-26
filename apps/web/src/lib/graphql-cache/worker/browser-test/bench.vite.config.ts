import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig, type Plugin } from 'vite';
import solid from 'vite-plugin-solid';
import base from './vite.config.ts';

const directory = fileURLToPath(new URL('.', import.meta.url));

const RUNTIME_MODULE = '/worker/cache-engine-runtime.ts';
const MEMORY_SAMPLE_INTERVAL = 'options.memoryTelemetryIntervalMs ?? 60_000';

/**
 * The worker samples its wasm memory at most once a minute; the channel pass
 * reads a sample at each of its checkpoints, so the bench build samples on
 * every heartbeat instead. The app's build is untouched. The worker bundles
 * build while the page does, so the page's build fails at its end if no
 * bundle had the line to rewrite.
 */
function sampleMemoryOnEveryHeartbeat(): { page: Plugin; worker: Plugin } {
  let rewritten = false;
  return {
    page: {
      name: 'bench-sample-memory-on-every-heartbeat-check',
      buildEnd(error) {
        if (!error && !rewritten) {
          this.error(
            `no worker module ${RUNTIME_MODULE} had ${MEMORY_SAMPLE_INTERVAL}`
          );
        }
      },
    },
    worker: {
      name: 'bench-sample-memory-on-every-heartbeat',
      // Before TypeScript is compiled, which rewrites the literal.
      enforce: 'pre',
      transform(code, id) {
        if (!id.endsWith(RUNTIME_MODULE)) return;
        if (!code.includes(MEMORY_SAMPLE_INTERVAL)) {
          this.error(
            `${RUNTIME_MODULE} no longer has ${MEMORY_SAMPLE_INTERVAL}`
          );
        }
        rewritten = true;
        return code.replace(
          MEMORY_SAMPLE_INTERVAL,
          'options.memoryTelemetryIntervalMs ?? 0'
        );
      },
    },
  };
}

/** Production build of the cache engine benchmark page alone (`bench-runner.ts`). */
export default defineConfig((env) => {
  const config = base(env);
  const memorySamples = sampleMemoryOnEveryHeartbeat();
  return mergeConfig(
    { ...config, build: { ...config.build, rolldownOptions: undefined } },
    {
      // Telemetry imports reach `.tsx` modules; compile them as the app does.
      plugins: [solid(), memorySamples.page],
      worker: { plugins: () => [memorySamples.worker] },
      build: {
        outDir: resolve(directory, '.dist-bench'),
        sourcemap: false,
        rolldownOptions: { input: { bench: resolve(directory, 'bench.html') } },
      },
    }
  );
});
