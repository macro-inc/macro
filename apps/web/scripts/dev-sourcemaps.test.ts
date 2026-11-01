import { get } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createServer } from 'vite';
import { expect, it } from 'vitest';
import { devExternalSourcemaps } from './dev-sourcemaps';

it('links inline source maps instead of sending them with every module', async () => {
  const map = JSON.stringify({
    version: 3,
    sources: ['NewChatPage.tsx'],
    sourcesContent: ['export const heading = "What should we work on?";'],
    mappings: 'AAAA',
  });
  const base64 = Buffer.from(map).toString('base64');
  const vite = await createServer({
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    plugins: [devExternalSourcemaps({})],
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: '127.0.0.1', port: 0 },
  });
  vite.middlewares.use((req, res) => {
    if (req.url === '/module.js')
      return res.end(
        `export const heading = "x";\n//# sourceMappingURL=data:application/json;base64,${base64}`
      );
    if (req.url === '/style.css')
      return res.end(
        `.a{color:red}\n/*# sourceMappingURL=data:application/json;base64,${base64} */`
      );
    res.end('export const plain = 1;');
  });
  try {
    await vite.listen();
    const { port } = vite.httpServer?.address() as AddressInfo;
    const fetchText = (path: string) =>
      new Promise<{ status: number | undefined; body: string }>(
        (resolve, reject) => {
          get({ host: '127.0.0.1', port, path }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
              body += chunk;
            });
            res.on('end', () => resolve({ status: res.statusCode, body }));
          }).on('error', reject);
        }
      );

    const module = await fetchText('/module.js');
    const linked = /\/\/# sourceMappingURL=(\/@macro-sourcemap\/[0-9a-f]{40}\.map)$/.exec(
      module.body
    );
    expect(module.body.startsWith('export const heading = "x";\n')).toBe(true);
    expect(linked).not.toBeNull();
    expect(await fetchText(linked?.[1] ?? '')).toEqual({ status: 200, body: map });

    expect((await fetchText('/style.css')).body).toBe(
      `.a{color:red}\n/*# sourceMappingURL=${linked?.[1]} */`
    );
    expect((await fetchText('/plain.js')).body).toBe('export const plain = 1;');
    expect((await fetchText('/@macro-sourcemap/missing.map')).status).toBe(404);
  } finally {
    await vite.close();
  }
});
