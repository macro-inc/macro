import { createServer, type Server } from 'node:http';
import { Readable } from 'node:stream';
/** Adapt Node HTTP to the Request/Response control handler used by the library. */
export async function serveHttp(
  options: {
    hostname?: string;
    port: number;
  },
  handler: (request: Request) => Response | Promise<Response>
): Promise<Server> {
  const server = createServer(async (incoming, outgoing) => {
    const stop = new AbortController();
    outgoing.on('close', () => stop.abort());
    try {
      const chunks: Buffer[] = [];
      if (incoming.method !== 'GET' && incoming.method !== 'HEAD')
        for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const body = chunks.length
        ? new Uint8Array(Buffer.concat(chunks))
        : undefined;
      const init: RequestInit & {
        duplex: 'half';
      } = {
        method: incoming.method,
        headers: Object.fromEntries(
          Object.entries(incoming.headers).flatMap(([key, value]) =>
            value === undefined
              ? []
              : [[key, Array.isArray(value) ? value.join(', ') : value]]
          )
        ),
        body,
        duplex: 'half',
        signal: stop.signal,
      };
      const response = await handler(
        new Request(
          `http://${incoming.headers.host ?? '127.0.0.1'}${incoming.url}`,
          init
        )
      );
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      if (!response.body) {
        outgoing.end();
        return;
      }
      outgoing.flushHeaders();
      const source = Readable.from(response.body);
      outgoing.on('close', () => source.destroy());
      source.on('error', () => outgoing.destroy());
      source.pipe(outgoing);
    } catch {
      if (!outgoing.headersSent) outgoing.writeHead(500);
      outgoing.end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.hostname ?? '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  return server;
}
export function httpPort(server: Server): number {
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('HTTP server has no TCP port');
  return address.port;
}
export async function closeHttp(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
}
