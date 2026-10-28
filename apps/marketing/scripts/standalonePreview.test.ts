// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { preview } from 'vite';
import { expect, it } from 'vitest';
import { standaloneDev } from './standaloneDev';

it('serves each prerendered product page for extensionless navigation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'marketing-preview-'));
  for (const route of ['', 'crm', 'email', 'channels']) {
    const directory = path.join(root, 'dist', route);
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, 'index.html'),
      `<h1>${route || 'Homepage'}</h1>`
    );
  }
  const server = await preview({
    configFile: false,
    root,
    plugins: [standaloneDev()],
    preview: { host: '127.0.0.1', port: 0 },
  });
  try {
    const address = server.httpServer.address();
    if (!address || typeof address === 'string')
      throw new Error('No preview port');
    const origin = `http://127.0.0.1:${address.port}`;
    for (const route of ['crm', 'email', 'channels']) {
      for (const suffix of ['', '/', '?theme=cream']) {
        const response = await fetch(`${origin}/${route}${suffix}`);
        expect(response.status).toBe(200);
        expect(await response.text()).toBe(`<h1>${route}</h1>`);
      }
    }
    expect(await (await fetch(origin)).text()).toBe('<h1>Homepage</h1>');
    expect((await fetch(`${origin}/does-not-exist`)).status).toBe(404);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.httpServer.close((error) => (error ? reject(error) : resolve()))
    );
    await rm(root, { recursive: true, force: true });
  }
});
