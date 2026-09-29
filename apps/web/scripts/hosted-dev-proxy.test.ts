import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { get, request } from 'node:https';
import type { AddressInfo, Socket } from 'node:net';
import { createServer, resolveConfig } from 'vite';
import { afterEach, expect, it, vi } from 'vitest';
import { developmentProxyUrl } from '../src/lib/core/constant/developmentProxy';
import { devHttps } from './dev-https';
import { hostedDevProxy } from './hosted-dev-proxy';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('maps dev HTTP and WebSocket URLs while preserving production and OAuth hosts', () => {
  vi.stubEnv('VITE_DEV_PROXY', 'true');
  vi.stubGlobal('location', { origin: 'https://coworker:5122' });
  expect(developmentProxyUrl('https://dev-gateway.macro.com/auth')).toBe(
    'https://coworker:5122/__macro_dev/gateway/auth'
  );
  expect(
    developmentProxyUrl('wss://services-dev.macro.com?token=fixture')
  ).toBe('wss://coworker:5122/__macro_dev/websocket?token=fixture');
  expect(
    developmentProxyUrl('https://sync-service-dev3.macroverse.workers.dev/doc')
  ).toBe('https://coworker:5122/__macro_dev/sync/doc');
  for (const url of [
    'https://gateway.macro.com/auth',
    'https://fusionauth-dev.macro.com/oauth2/logout',
  ]) {
    expect(developmentProxyUrl(url)).toBe(url);
  }
  vi.stubEnv('VITE_DEV_PROXY', 'false');
  expect(developmentProxyUrl('https://dev-gateway.macro.com/auth')).toBe(
    'https://dev-gateway.macro.com/auth'
  );
});

it('forwards authenticated HTTP and WS over HTTPS, rewrites cookies, and rejects other origins', async () => {
  const sockets = new Set<Socket>();
  const upgrades: { cookie: string | undefined; path: string | undefined }[] =
    [];
  let requests = 0;
  const backend = createHttpServer((req, res) => {
    requests++;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Set-Cookie',
      'dev-macro-access-token=fixture; Domain=macro.com; Path=/; Secure; HttpOnly; SameSite=None'
    );
    res.end(
      JSON.stringify({
        path: req.url,
        cookie: req.headers.cookie,
        host: req.headers.host,
      })
    );
  });
  backend.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  backend.on('upgrade', (req, socket) => {
    upgrades.push({ cookie: req.headers.cookie, path: req.url });
    const accept = createHash('sha1')
      .update(
        `${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`
      )
      .digest('base64');
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
  });
  await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', resolve));
  const upstream = `http://127.0.0.1:${(backend.address() as AddressInfo).port}`;
  const vite = await createServer({
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    plugins: [devHttps({}), hostedDevProxy({}, { gateway: upstream })],
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: '127.0.0.1', port: 0 },
  });
  try {
    vite.middlewares.use((_req, res) => res.end('frontend'));
    await vite.listen();
    const address = vite.httpServer?.address();
    if (!address || typeof address === 'string')
      throw new Error('No Vite listener');
    const origin = `https://localhost:${address.port}`;
    const options = {
      hostname: '127.0.0.1',
      port: address.port,
      servername: 'localhost',
      ca: readFileSync(
        new URL('../../../infra/local/certs/ca.pem', import.meta.url)
      ),
    };
    const cookie = 'dev-macro-access-token=fixture';
    const fetchPage = (path: string, requestOrigin = origin) =>
      new Promise<{
        status: number | undefined;
        body: string;
        cookies: string[];
      }>((resolve, reject) => {
        get(
          {
            ...options,
            path,
            headers: {
              host: new URL(origin).host,
              origin: requestOrigin,
              cookie,
            },
          },
          (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
              body += chunk;
            });
            res.on('end', () =>
              resolve({
                status: res.statusCode,
                body,
                cookies: res.headers['set-cookie'] ?? [],
              })
            );
            res.on('error', reject);
          }
        ).on('error', reject);
      });
    const response = await fetchPage(
      '/__macro_dev/gateway/auth/user/me?check=1'
    );
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      path: '/auth/user/me?check=1',
      cookie,
      host: new URL(upstream).host,
    });
    expect(response.cookies).toEqual([
      `${cookie}; Path=/; Secure; HttpOnly; SameSite=None`,
    ]);
    expect((await fetchPage('/__macro_dev/gatewayish/auth')).body).toBe(
      'frontend'
    );
    const before = requests;
    expect(
      (
        await fetchPage(
          '/__macro_dev/gateway/auth',
          'https://unrelated.example'
        )
      ).status
    ).toBe(403);
    expect(requests).toBe(before);

    const connect = (requestOrigin: string) =>
      new Promise<void>((resolve, reject) => {
        const req = request({
          ...options,
          path: '/__macro_dev/gateway/connection-gateway?check=1',
          headers: {
            host: new URL(origin).host,
            origin: requestOrigin,
            cookie,
            connection: 'Upgrade',
            upgrade: 'websocket',
            'sec-websocket-version': '13',
            'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
          },
        });
        req.setTimeout(3000, () => req.destroy(new Error('WS timeout')));
        req.on('error', reject);
        req.on('response', (res) => {
          res.resume();
          reject(new Error(`WS status ${res.statusCode}`));
        });
        req.on('upgrade', (_res, socket) => {
          socket.destroy();
          resolve();
        });
        req.end();
      });
    await connect(origin);
    expect(upgrades).toEqual([{ cookie, path: '/connection-gateway?check=1' }]);
    await expect(connect('https://unrelated.example')).rejects.toThrow();
    expect(upgrades).toHaveLength(1);
  } finally {
    for (const socket of sockets) socket.destroy();
    await vite.close();
    await new Promise<void>((resolve) => backend.close(() => resolve()));
  }
});

it.each([
  { TAURI_ENV_PLATFORM: 'linux' },
  { MACRO_LOCAL_BACKEND_PROXY: 'https://localhost:8090' },
  { MACRO_DEV_PROXY: 'false' },
])('keeps the existing backend selection for %j', async (env) => {
  const config = await resolveConfig(
    { configFile: false, plugins: [hostedDevProxy(env)] },
    'serve'
  );
  expect(config.server.proxy).toBeUndefined();
  expect(config.define?.['import.meta.env.VITE_DEV_PROXY']).toBeUndefined();
});
