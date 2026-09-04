import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { expect, it } from 'vitest';
import { createAppViteConfig } from '../vite.base';

it('keeps app and workspace Loro imports identical after dependency rebuilding', async () => {
  const cacheDir = await mkdtemp(resolve(tmpdir(), 'macro-loro-resolution-'));
  const config = await createAppViteConfig()({
    command: 'serve',
    mode: 'development',
  });
  const server = await createServer({
    ...config,
    configFile: false,
    cacheDir,
    server: { ...config.server, middlewareMode: true, hmr: false },
    optimizeDeps: {
      ...config.optimizeDeps,
      noDiscovery: true,
      include: [],
      entries: [],
    },
  });

  try {
    const client = server.environments.client;
    const optimizer = client.depsOptimizer!;
    const appImporter = resolve(
      'src/lib/core/component/LexicalMarkdown/collaboration/undo.ts'
    );
    const workspaceImporter = resolve(
      '../../packages/collaboration/src/collab/manager.ts'
    );
    const resolveLoro = (importer: string) =>
      client.pluginContainer.resolveId('loro-crdt', importer);

    // Warm the resolver before simulating the version change from a rebuild.
    optimizer.metadata.browserHash = 'before-rebuild';
    await resolveLoro(appImporter);
    await resolveLoro(workspaceImporter);
    optimizer.metadata.browserHash = 'after-rebuild';

    const app = await resolveLoro(appImporter);
    const workspace = await resolveLoro(workspaceImporter);
    expect(app?.id).toBeTruthy();
    expect(app?.id).toBe(workspace?.id);
  } finally {
    await server.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});
