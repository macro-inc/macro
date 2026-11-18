// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, preview } from 'vite';
import { expect, it } from 'vitest';
import { standaloneDev } from './standaloneDev';

it.each([
  ['dev', undefined],
  ['preview', undefined],
  ['dev', 'https://app.example.test'],
  ['preview', 'https://app.example.test'],
] as const)(
  'hands app navigation to the configured app in %s (%s)',
  async (mode, configuredOrigin) => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), 'marketing-app-redirect-')
    );
    if (configuredOrigin)
      await writeFile(
        path.join(root, '.env'),
        `VITE_APP_BASE_URL=${configuredOrigin}`
      );
    const expectedOrigin = configuredOrigin ?? 'https://macro.com';
    const config = {
      configFile: false as const,
      root,
      plugins: [standaloneDev()],
      server: { host: '127.0.0.1', port: 0 },
      preview: { host: '127.0.0.1', port: 0 },
    };
    const server =
      mode === 'dev' ? await createServer(config) : await preview(config);
    try {
      if ('listen' in server) await server.listen();
      const address = server.httpServer?.address();
      if (!address || typeof address === 'string')
        throw new Error('No preview port');
      const origin = `http://127.0.0.1:${address.port}`;
      for (const route of [
        '/app',
        '/app/signup',
        '/app/onboarding?step=team',
      ]) {
        for (const method of ['GET', 'HEAD']) {
          const response = await fetch(`${origin}${route}`, {
            method,
            redirect: 'manual',
          });
          expect(response.status).toBe(302);
          expect(response.headers.get('location')).toBe(
            `${expectedOrigin}${route}`
          );
          expect(response.headers.get('cache-control')).toBe('no-store');
          expect(await response.text()).toBe('');
        }
      }
      const unrelated = await fetch(`${origin}/apple.txt`, {
        redirect: 'manual',
      });
      expect(unrelated.headers.get('location')).toBeNull();
    } finally {
      await server.close();
      await rm(root, { recursive: true, force: true });
    }
  }
);

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
