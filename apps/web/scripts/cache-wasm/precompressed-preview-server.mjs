#!/usr/bin/env node

import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, resolve, sep } from 'node:path';

const dist = resolve(process.argv[2] ?? 'dist');
const port = Number(process.env.PORT ?? 4189);
if (!Number.isSafeInteger(port) || port <= 0) {
  throw new Error(`invalid PORT: ${process.env.PORT}`);
}
if (!existsSync(dist) || !statSync(dist).isDirectory()) {
  throw new Error(`production browser dist is missing: ${dist}`);
}

const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon'],
  ['.woff2', 'font/woff2'],
  ['.wasm', 'application/wasm'],
]);

createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
  if (url.pathname === '/app') {
    response.writeHead(302, { location: '/app/' });
    response.end();
    return;
  }
  if (!url.pathname.startsWith('/app/')) {
    response.writeHead(404).end('not found');
    return;
  }
  let relativePath;
  try {
    relativePath = decodeURIComponent(url.pathname.slice('/app/'.length));
  } catch {
    response.writeHead(400).end('invalid path encoding');
    return;
  }
  const requestedPath = resolve(dist, relativePath || 'index.html');
  if (
    requestedPath !== dist &&
    !requestedPath.startsWith(`${dist}${sep}`)
  ) {
    response.writeHead(400).end('invalid path');
    return;
  }
  const isWasm = extname(requestedPath) === '.wasm';
  const isCacheWasm =
    isWasm && /^cache_wasm_bg(?:-[\w-]+)?\.wasm$/.test(basename(requestedPath));
  const bodyPath = isCacheWasm ? `${requestedPath}.br` : requestedPath;
  if (!existsSync(bodyPath) || !statSync(bodyPath).isFile()) {
    response.writeHead(404).end('not found');
    return;
  }
  const body = readFileSync(bodyPath);
  const headers = {
    'content-type': contentTypes.get(extname(requestedPath)) ?? 'application/octet-stream',
    'content-length': String(body.byteLength),
    'cache-control': 'public, max-age=31536000, immutable',
    ...(isCacheWasm ? { 'content-encoding': 'br' } : {}),
  };
  response.writeHead(200, headers);
  response.end(request.method === 'HEAD' ? undefined : body);
}).listen(port, '127.0.0.1', () => {
  process.stdout.write(
    `precompressed cache WASM preview listening at http://127.0.0.1:${port}/app/\n`
  );
});
