import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { expect, it } from 'vitest';
import { sessionBootstrap } from './session-bootstrap';
import { startupChunks } from './startup-chunks';

it('emits an independent async session graph without app or dynamic view evaluation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-bootstrap-'));
  try {
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'index.html'), '<html><head></head><body><script type="module" src="/src/main.js"></script></body></html>');
    await writeFile(join(root, 'src/main.js'), 'import { session } from "./session.js"; window.app = session + "app-only-evaluation";');
    await writeFile(join(root, 'src/session.js'), 'export const session = "shared-session-owner";');
    await writeFile(join(root, 'src/session-bootstrap.ts'), 'import { session } from "./session.js"; window.session = session; window.loadView = () => import("./view.js");');
    await writeFile(join(root, 'src/view.js'), 'window.view = "view-only-evaluation";');
    const result = await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [sessionBootstrap()],
      build: { write: false, minify: false, rollupOptions: { output: { manualChunks: startupChunks(), onlyExplicitManualChunks: true } } },
    });
    if (Array.isArray(result) || !('output' in result))
      throw new Error('Expected a single build output');
    const html = result.output.find(file => file.type === 'asset' && file.fileName === 'index.html');
    if (!html || html.type !== 'asset') throw new Error('missing HTML');
    const bootstrap = result.output.find(file => file.type === 'chunk' && file.facadeModuleId === join(root, 'src/session-bootstrap.ts'));
    if (!bootstrap || bootstrap.type !== 'chunk') throw new Error('missing bootstrap');
    expect(String(html.source)).toMatch(new RegExp(`<script[^>]*async[^>]*src="/${bootstrap.fileName}"`));
    const seen = new Set<string>();
    function inspect(fileName: string) {
      if (seen.has(fileName)) return;
      seen.add(fileName);
      const file = result.output.find(file => file.fileName === fileName);
      if (!file || file.type !== 'chunk') throw new Error(`missing chunk ${fileName}`);
      expect(file.code).not.toContain('app-only-evaluation');
      expect(file.code).not.toContain('view-only-evaluation');
      for (const dependency of file.imports) inspect(dependency);
    }
    inspect(bootstrap.fileName);
    const app = result.output.find(
      file => file.type === 'chunk' && file.facadeModuleId === join(root, 'index.html')
    );
    if (!app || app.type !== 'chunk') throw new Error('missing app');
    const runtime = new Set<string>();
    function inspectApp(fileName: string) {
      if (runtime.has(fileName)) return;
      runtime.add(fileName);
      expect(fileName).not.toBe(bootstrap.fileName);
      const file = result.output.find(file => file.fileName === fileName);
      if (!file || file.type !== 'chunk') throw new Error(`missing app chunk ${fileName}`);
      for (const dependency of file.imports) inspectApp(dependency);
    }
    inspectApp(app.fileName);
    expect(result.output.filter(file => file.type === 'chunk' && file.code.includes('shared-session-owner'))).toHaveLength(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
