import type { IncomingMessage, ServerResponse } from 'node:http';
import { constants, gzip } from 'node:zlib';
import type { Connect, Plugin } from 'vite';

const COMPRESSIBLE =
  /^(text\/|application\/(javascript|json|wasm|xml|manifest\+json)|image\/svg)/;
const MIN_BYTES = 1024;

/**
 * Gzips the dev server's transformed modules. Vite sends them uncompressed,
 * which is fine on localhost but ~80 MB per cold load to a remote browser.
 * Only responses sent in a single `end(body)` call are compressed (Vite's
 * module and dependency responses); streamed static files pass through.
 */
export function devCompression(
  env: Record<string, string | undefined> = process.env
): Plugin {
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    if (!/\bgzip\b/.test(String(req.headers['accept-encoding'] ?? '')))
      return next();
    compressSingleShot(req, res);
    next();
  };
  return {
    name: 'macro-dev-compression',
    apply: (_config, { command, isPreview }) =>
      command === 'serve' && !isPreview && env.MACRO_DEV_COMPRESSION !== 'false',
    configureServer(server) {
      // Before Vite's own middlewares, so module responses pass through it.
      server.middlewares.use(middleware);
    },
  };
}

function compressSingleShot(_req: IncomingMessage, res: ServerResponse) {
  let streamed = false;
  const write = res.write;
  res.write = function (this: ServerResponse, ...args: Parameters<typeof write>) {
    streamed = true;
    return write.apply(this, args);
  } as typeof write;

  const end = res.end;
  // One signature, so TypeScript can resolve `call` with just a body.
  const endWith = end as (this: ServerResponse, body: Buffer) => ServerResponse;
  res.end = function (this: ServerResponse, ...args: unknown[]) {
    const [body] = args;
    const restore = () => {
      res.write = write;
      res.end = end;
    };
    const buffer =
      typeof body === 'string'
        ? Buffer.from(body)
        : Buffer.isBuffer(body)
          ? body
          : body instanceof Uint8Array
            ? Buffer.from(body)
            : undefined;
    const type = String(res.getHeader('content-type') ?? '');
    if (
      streamed ||
      res.headersSent ||
      !buffer ||
      buffer.length < MIN_BYTES ||
      res.statusCode !== 200 ||
      res.getHeader('content-encoding') ||
      !COMPRESSIBLE.test(type)
    ) {
      restore();
      return end.apply(this, args as Parameters<typeof end>);
    }
    gzip(buffer, { level: constants.Z_BEST_SPEED }, (error, compressed) => {
      restore();
      if (error) {
        endWith.call(this, buffer);
        return;
      }
      res.setHeader('content-encoding', 'gzip');
      res.setHeader('content-length', compressed.length);
      const vary = res.getHeader('vary');
      res.setHeader('vary', vary ? `${vary}, Accept-Encoding` : 'Accept-Encoding');
      endWith.call(this, compressed);
    });
    return this;
  } as typeof end;
}
