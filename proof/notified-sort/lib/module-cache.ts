// The browser's way to the dev servers when it runs in its own network
// namespace (chromium-netns.sh): one HTTP proxy per port, listening on a Unix
// socket on the host. It lets the browser keep the app's modules between
// documents. Vite answers every source module with `Cache-Control: no-cache`,
// so each lane reload revalidates a few thousand modules, and one browser
// serves those one reload at a time (5 s each here, 30 s for six at once).
// The modules do not change during a run (a mutant is applied before it
// starts), so the proxy marks JavaScript and CSS responses cacheable. HTML
// documents, API calls (JSON, GraphQL) and websockets pass through untouched,
// so a reload still boots a new app that reads everything else from the
// server.
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Requests that reached the proxy, for dbg-loadtime.ts. */
export const moduleCacheStats = { requests: 0, cacheable: 0 };

const CACHEABLE = /^(text|application)\/(javascript|css)\b/;

function cacheable(method: string | undefined, headers: IncomingHttpHeaders, status: number | undefined) {
  return method === 'GET' && status === 200 && CACHEABLE.test(String(headers['content-type'] ?? ''));
}

function proxyTo(port: number): Server {
  const server = createServer((req, res) => {
    moduleCacheStats.requests += 1;
    const upstream = request(
      { host: '127.0.0.1', port, method: req.method, path: req.url, headers: req.headers },
      (answer) => {
        const headers = { ...answer.headers };
        if (cacheable(req.method, headers, answer.statusCode)) {
          headers['cache-control'] = 'private, max-age=86400';
          moduleCacheStats.cacheable += 1;
        }
        res.writeHead(answer.statusCode ?? 502, answer.statusMessage, headers);
        answer.pipe(res);
      }
    );
    upstream.on('error', () => res.destroy());
    req.pipe(upstream);
  });
  server.on('upgrade', (req, socket, head) => {
    const upstream = connect(port, '127.0.0.1', () => {
      const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });
  return server;
}

/** Start one proxy per port; returns the directory holding `<port>.sock`. */
export async function startModuleCache(ports: number[]): Promise<{ dir: string; close: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), 'proof-netns-'));
  const servers = await Promise.all(
    ports.map(
      (port) =>
        new Promise<Server>((resolve, reject) => {
          const server = proxyTo(port);
          server.once('error', reject);
          server.listen(join(dir, `${port}.sock`), () => resolve(server));
        })
    )
  );
  return {
    dir,
    close: () => {
      for (const server of servers) server.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
