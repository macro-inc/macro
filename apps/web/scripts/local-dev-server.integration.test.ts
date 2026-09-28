import { createHash } from 'node:crypto';
import { createServer as createHttpServer, get as httpGet } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { createServer } from 'vite';
import { expect, it } from 'vitest';
import { localDevServer } from './local-dev-server';

it('proxies real HTTP and WebSocket requests through Vite without rewriting paths', async () => {
  const sockets = new Set<Socket>();
  const backend = createHttpServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Set-Cookie', 'proxy-test=ok; Path=/; SameSite=Lax');
    res.end(
      JSON.stringify({
        url: req.url,
        method: req.method,
        cookie: req.headers.cookie,
        host: req.headers.host,
        forwardedHost: req.headers['x-forwarded-host'],
      })
    );
  });
  // Minimal server-to-client WebSocket frame: no additional test dependency.
  backend.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  backend.on('upgrade', (req, socket) => {
    const accept = createHash('sha1')
      .update(
        `${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`
      )
      .digest('base64');
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    const payload = Buffer.from(req.url ?? '');
    socket.write(Buffer.concat([Buffer.from([0x81, payload.length]), payload]));
  });
  await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', resolve));
  const target = `http://127.0.0.1:${(backend.address() as AddressInfo).port}`;
  const vite = await createServer({
    configFile: false,
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    server: {
      host: '127.0.0.1',
      port: 0,
      ...localDevServer({
        MACRO_LOCAL_BACKEND_PROXY: target,
        MACRO_LOCAL_BACKEND_ROUTES: '/auth,/connection-gateway,/i',
      }),
    },
  });
  try {
    vite.middlewares.use((_req, res) => res.end('frontend'));
    await vite.listen();
    const address = vite.httpServer?.address();
    if (!address || typeof address === 'string')
      throw new Error('Vite has no TCP listener');
    const origin = `http://127.0.0.1:${address.port}`;
    const response = await fetch(`${origin}/auth/health?check=1`, {
      headers: { cookie: 'session=test' },
    });
    expect(await response.json()).toEqual({
      url: '/auth/health?check=1',
      method: 'GET',
      cookie: 'session=test',
      host: new URL(target).host,
      forwardedHost: new URL(origin).host,
    });
    expect(response.headers.get('set-cookie')).toContain('proxy-test=ok');
    // Use Node HTTP: fetch does not reliably preserve an explicit Host header.
    for (const host of ['wolf-macro-google', 'arbitrary-host.example']) {
      const request = (path: string) =>
        new Promise<{ status: number | undefined; body: string }>(
          (resolve, reject) => {
            httpGet(`${origin}${path}`, { headers: { host } }, (res) => {
              let body = '';
              res.setEncoding('utf8');
              res.on('data', (chunk) => {
                body += chunk;
              });
              res.on('end', () => resolve({ status: res.statusCode, body }));
              res.on('error', reject);
            }).on('error', reject);
          }
        );
      expect(await request('/app/')).toEqual({ status: 200, body: 'frontend' });
      const proxied = await request('/auth/health');
      expect(proxied.status).toBe(200);
      expect(JSON.parse(proxied.body)).toMatchObject({
        host: new URL(target).host,
        forwardedHost: host,
      });
    }
    const telemetry = await fetch(`${origin}/i/otlp/v1/traces`, {
      method: 'POST',
      body: 'fixture',
    });
    expect(await telemetry.json()).toMatchObject({
      url: '/i/otlp/v1/traces',
      method: 'POST',
    });
    expect(await fetch(`${origin}/authentic`).then((res) => res.text())).toBe(
      'frontend'
    );
    const client = await fetch(`${origin}/@vite/client`).then((res) =>
      res.text()
    );
    expect(client).toContain('import.meta.url');

    const path = '/connection-gateway?check=1';
    const socket = new WebSocket(origin.replace(/^http/, 'ws') + path);
    try {
      const message = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('WebSocket proxy timeout')),
          3000
        );
        socket.addEventListener(
          'message',
          (event) => {
            clearTimeout(timer);
            resolve(String(event.data));
          },
          { once: true }
        );
        socket.addEventListener(
          'error',
          () => {
            clearTimeout(timer);
            reject(new Error('WebSocket proxy failed'));
          },
          { once: true }
        );
      });
      expect(message).toBe(path);
    } finally {
      socket.close();
    }
  } finally {
    for (const socket of sockets) socket.destroy();
    await vite.close();
    await new Promise<void>((resolve) => backend.close(() => resolve()));
  }
});
