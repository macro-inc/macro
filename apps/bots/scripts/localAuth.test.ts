import { expect, test } from 'bun:test';
import { request } from 'node:http';
import { createServer } from 'vite';
import { localAuth } from './localAuth';

test('local auth refuses non-loopback server configuration', async () => {
  const result = await createServer({
    configFile: false,
    plugins: [localAuth('/auth-proof')],
    server: { host: '0.0.0.0', port: 0, cors: false },
  }).then(
    async (server) => {
      await server.close();
      return 'Accepted a non-loopback server';
    },
    (error: unknown) => (error instanceof Error ? error.message : '')
  );
  expect(result).toContain('requires an ephemeral loopback server');
});

test('local auth rejects a foreign Host and cross-origin exchange', async () => {
  const path = '/auth-proof';
  const server = await createServer({
    configFile: false,
    plugins: [localAuth(path)],
    optimizeDeps: { noDiscovery: true },
    server: { host: '127.0.0.1', port: 0, cors: false, ws: false },
  });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (typeof address !== 'object' || !address) {
      throw new Error('Loopback server did not bind');
    }
    const origin = `http://127.0.0.1:${address.port}`;
    const crossOrigin = await fetch(origin + `${path}/complete`, {
      method: 'POST',
      headers: { Origin: 'http://127.0.0.1:23030' },
    });
    expect(crossOrigin.status).toBe(403);
    await crossOrigin.body?.cancel();

    const foreignHost = await new Promise<number | undefined>(
      (resolve, reject) => {
        request(
          origin + path,
          { headers: { Host: 'other.localhost' } },
          (response) => {
            response.resume();
            resolve(response.statusCode);
          }
        )
          .on('error', reject)
          .end();
      }
    );
    expect(foreignHost).toBe(403);

    const unsignedReads = await fetch(origin + `${path}/hire-access`);
    expect(unsignedReads.status).toBe(401);
    expect(await unsignedReads.json()).toEqual({ status: 'signed-out' });

    const purchase = await fetch(origin + `${path}/hire-access`, {
      method: 'POST',
      headers: { Origin: origin },
    });
    expect(purchase.status).toBe(404);
    await purchase.body?.cancel();

    const signedOut = await fetch(origin + path);
    expect(await signedOut.json()).toEqual({ status: 'signed-out' });
  } finally {
    await server.close();
  }
});
