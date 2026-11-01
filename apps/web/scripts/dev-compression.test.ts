import { get } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gunzipSync } from 'node:zlib';
import { createServer } from 'vite';
import { expect, it } from 'vitest';
import { devCompression } from './dev-compression';

it('gzips single-shot module responses and passes everything else through', async () => {
  const module = `export const value = ${JSON.stringify('x'.repeat(4000))};\n`;
  const vite = await createServer({
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    plugins: [devCompression({})],
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: '127.0.0.1', port: 0 },
  });
  vite.middlewares.use((req, res) => {
    res.setHeader('Content-Type', 'text/javascript');
    if (req.url === '/module.js') return res.end(module);
    if (req.url === '/small.js') return res.end('export {};');
    res.write(module.slice(0, 2000));
    res.end(module.slice(2000));
  });
  try {
    await vite.listen();
    const { port } = vite.httpServer?.address() as AddressInfo;
    const fetchRaw = (path: string, acceptEncoding: string) =>
      new Promise<{ encoding: string | undefined; body: Buffer }>(
        (resolve, reject) => {
          get(
            {
              host: '127.0.0.1',
              port,
              path,
              headers: { 'accept-encoding': acceptEncoding },
            },
            (res) => {
              const chunks: Buffer[] = [];
              res.on('data', (chunk: Buffer) => chunks.push(chunk));
              res.on('end', () =>
                resolve({
                  encoding: res.headers['content-encoding'],
                  body: Buffer.concat(chunks),
                })
              );
              res.on('error', reject);
            }
          ).on('error', reject);
        }
      );

    const compressed = await fetchRaw('/module.js', 'gzip, br');
    expect(compressed.encoding).toBe('gzip');
    expect(compressed.body.length).toBeLessThan(module.length / 10);
    expect(gunzipSync(compressed.body).toString()).toBe(module);

    expect(await fetchRaw('/module.js', 'identity')).toEqual({
      encoding: undefined,
      body: Buffer.from(module),
    });
    expect(await fetchRaw('/small.js', 'gzip')).toEqual({
      encoding: undefined,
      body: Buffer.from('export {};'),
    });
    expect(await fetchRaw('/streamed.js', 'gzip')).toEqual({
      encoding: undefined,
      body: Buffer.from(module),
    });
  } finally {
    await vite.close();
  }
});
