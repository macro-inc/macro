// Serves one frontend bundle on its own port in front of the gqlchan stack,
// so a browser proof can load main's or the branch's build while the stack's
// own frontend directory keeps serving the differential's probe bundles.
//
//   node side-serve.mjs <port> <bundle-dir> [upstream]
//
// /app/* comes from <bundle-dir> (index.html for unknown paths, as the stack's
// Caddy does); every other request and websocket goes to the upstream
// (default https://localhost:29509) with Origin and Referer rewritten to it,
// so the services see the same origin they see from the stack's own page.
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import tls from 'node:tls';

const [portArg, dirArg, upstreamArg] = process.argv.slice(2);
if (!portArg || !dirArg) {
  console.error('usage: side-serve.mjs <port> <bundle-dir> [upstream]');
  process.exit(2);
}
const PORT = Number(portArg);
const ROOT = path.resolve(dirArg);
const UPSTREAM = new URL(upstreamArg ?? 'https://localhost:29509');
const CERTS = path.resolve(
  process.env.CERTS ??
    `${process.env.REPO_ROOT}/infra/local/generated/gqlchan/proxy/certs`
);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function upstreamHeaders(headers) {
  const out = { ...headers, host: UPSTREAM.host };
  if (out.origin) out.origin = UPSTREAM.origin;
  if (out.referer) {
    try {
      const referer = new URL(out.referer);
      out.referer = `${UPSTREAM.origin}${referer.pathname}${referer.search}`;
    } catch {
      delete out.referer;
    }
  }
  return out;
}

function serveFile(req, res) {
  const url = new URL(req.url, 'https://side');
  const relative = decodeURIComponent(url.pathname.replace(/^\/app\/?/, ''));
  let file = path.join(ROOT, relative);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory())
    file = path.join(ROOT, 'index.html');
  res.writeHead(200, {
    'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  fs.createReadStream(file).pipe(res);
}

const server = https.createServer(
  {
    cert: fs.readFileSync(path.join(CERTS, 'server.pem')),
    key: fs.readFileSync(path.join(CERTS, 'server-key.pem')),
  },
  (req, res) => {
    if (req.url === '/' || req.url.startsWith('/?')) {
      res.writeHead(302, { location: `/app/${req.url.slice(1)}` });
      res.end();
      return;
    }
    if (req.url === '/app') {
      res.writeHead(308, { location: '/app/' });
      res.end();
      return;
    }
    if (req.url.startsWith('/app/')) return serveFile(req, res);
    const forward = https.request(
      {
        hostname: UPSTREAM.hostname,
        port: UPSTREAM.port,
        path: req.url,
        method: req.method,
        headers: upstreamHeaders(req.headers),
        rejectUnauthorized: false,
      },
      (upstream) => {
        res.writeHead(upstream.statusCode ?? 502, upstream.headers);
        upstream.pipe(res);
      }
    );
    forward.on('error', (error) => {
      if (!res.headersSent) res.writeHead(502);
      res.end(String(error));
    });
    req.pipe(forward);
  }
);

// Websockets: replay the upgrade request to the upstream over TLS and splice.
server.on('upgrade', (req, socket, head) => {
  const upstream = tls.connect(
    { host: UPSTREAM.hostname, port: Number(UPSTREAM.port), rejectUnauthorized: false, servername: UPSTREAM.hostname },
    () => {
      const headers = upstreamHeaders(req.headers);
      let raw = `${req.method} ${req.url} HTTP/1.1\r\n`;
      for (const [name, value] of Object.entries(headers))
        for (const one of [].concat(value)) raw += `${name}: ${one}\r\n`;
      upstream.write(`${raw}\r\n`);
      if (head?.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    }
  );
  const close = () => {
    upstream.destroy();
    socket.destroy();
  };
  upstream.on('error', close);
  socket.on('error', close);
});

server.listen(PORT, () => console.log(`side-serve ${ROOT} on https://localhost:${PORT} -> ${UPSTREAM.origin}`));
