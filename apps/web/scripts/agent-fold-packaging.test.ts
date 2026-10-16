import { fileURLToPath } from 'node:url';
import { build, type Rollup } from 'vite';
import { expect, it } from 'vitest';
import { createAppViteConfig } from '../vite.base';

it('bundles the agent fold client URL as a compiled worker in production', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const config = await createAppViteConfig()({
    command: 'build',
    mode: 'production',
  });
  const workerPlugins = config.worker?.plugins;
  const result = (await build({
    ...config,
    configFile: false,
    root,
    publicDir: false,
    logLevel: 'silent',
    worker: {
      ...config.worker,
      plugins: () => [
        ...(workerPlugins?.() ?? []),
        {
          // Exercise the real worker entry and its imports without requiring
          // generated Rust artifacts for this packaging regression test.
          name: 'test-agent-fold-wasm-loader',
          load(id) {
            if (id.endsWith('/agent-fold/wasm-module.ts')) {
              return 'export async function loadAgentFoldWasm() { throw new Error("test loader"); }';
            }
          },
        },
      ],
    },
    build: {
      ...config.build,
      write: false,
      rollupOptions: {
        input: `${root}/src/lib/core/agent-fold/client.ts`,
        preserveEntrySignatures: 'strict',
      },
    },
  })) as Rollup.RollupOutput;

  const worker = result.output.find((file) =>
    /^fold\.worker-[\w-]+\.js$/.test(file.fileName)
  );
  expect(worker).toBeDefined();
  const client = result.output.find(
    (file) => file.type === 'chunk' && file.isEntry
  );
  expect(client?.type).toBe('chunk');
  if (client?.type !== 'chunk') throw new Error('missing client entry');
  expect(client.code).toContain(worker!.fileName);
  expect(client.code).not.toContain('data:video/mp2t');
}, 30_000);
