import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { get, request } from 'node:https';
import { createServer, resolveConfig } from 'vite';
import { expect, it } from 'vitest';
import { devHttps } from './dev-https';

const ca = readFileSync(
  new URL('../../../infra/local/certs/ca.pem', import.meta.url)
);

it('serves HTTPS and HMR with the existing CA and detected hostname', async () => {
  const hostname = execFileSync('hostname', { encoding: 'utf8' })
    .trim()
    .toLowerCase();
  const vite = await createServer({
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    plugins: [devHttps({})],
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: '127.0.0.1', port: 0 },
  });
  try {
    vite.middlewares.use((_req, res) => res.end('frontend'));
    await vite.listen();
    const address = vite.httpServer?.address();
    if (!address || typeof address === 'string')
      throw new Error('Vite has no TCP listener');
    const options = { hostname: '127.0.0.1', port: address.port, ca };
    const fetchPage = (servername: string, trusted = true) =>
      new Promise<string>((resolve, reject) => {
        get(
          {
            ...options,
            servername,
            ca: trusted ? ca : [],
            path: '/app/',
          },
          (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
              body += chunk;
            });
            res.on('end', () => resolve(body));
            res.on('error', reject);
          }
        ).on('error', reject);
      });
    expect(await fetchPage(hostname)).toBe('frontend');
    expect(await fetchPage('localhost')).toBe('frontend');
    await expect(fetchPage('unrelated.example')).rejects.toMatchObject({
      code: 'ERR_TLS_CERT_ALTNAME_INVALID',
    });
    await expect(fetchPage(hostname, false)).rejects.toThrow();

    // A real TLS WebSocket upgrade with Vite's browser origin/token checks,
    // resolving to the negotiated protocol or the rejection status.
    const upgradeHmr = (host: string) =>
      new Promise<string | undefined>((resolve, reject) => {
        const req = request({
          ...options,
          servername: hostname,
          path: `/?token=${vite.config.webSocketToken}`,
          headers: {
            host,
            origin: `https://${host}`,
            connection: 'Upgrade',
            upgrade: 'websocket',
            'sec-websocket-version': '13',
            'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
            'sec-websocket-protocol': 'vite-hmr',
          },
        });
        req.setTimeout(3000, () =>
          req.destroy(new Error('HMR upgrade timeout'))
        );
        req.on('error', reject);
        req.on('response', (res) => {
          res.resume();
          resolve(`HTTP ${res.statusCode}`);
        });
        req.on('upgrade', (res, socket) => {
          socket.destroy();
          resolve(res.headers['sec-websocket-protocol']);
        });
        req.end();
      });
    for (const [host, expected] of [
      [`${hostname}:${address.port}`, 'vite-hmr'],
      // Tailscale Serve forwards the devbox's MagicDNS name as the Host.
      ['devbox.example-tailnet.ts.net', 'vite-hmr'],
      ['unrelated.example', 'HTTP 400'],
    ]) {
      expect(await upgradeHmr(host), host).toBe(expected);
    }
  } finally {
    await vite.close();
  }
});

it.each([
  { TAURI_ENV_PLATFORM: 'linux' },
  { TAURI_DEV_HOST: '192.168.1.2' },
  { MACRO_LOCAL_BACKEND_PROXY: 'https://localhost:8090' },
  { MACRO_DEV_HTTPS: 'false' },
])('preserves HTTP for %j', async (env) => {
  const config = await resolveConfig(
    { configFile: false, plugins: [devHttps(env)] },
    'serve'
  );
  expect(config.server.https).toBeUndefined();
});

it.each(['build', 'preview'] as const)(
  'does not issue certificates for %s',
  async (command) => {
    const config = await resolveConfig(
      { configFile: false, plugins: [devHttps({})] },
      command === 'preview' ? 'serve' : 'build',
      'development',
      'development',
      command === 'preview'
    );
    expect(config.server.https).toBeUndefined();
  }
);
