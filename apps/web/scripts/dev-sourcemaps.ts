import { createHash } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import type { Connect, Plugin } from 'vite';

const PREFIX = '/@macro-sourcemap/';
const INLINE_MAP =
  /\n(\/\/# sourceMappingURL=|\/\*# sourceMappingURL=)data:application\/json;(?:charset=utf-8;)?base64,([A-Za-z0-9+/=]+)( \*\/)?\s*$/;
/** Maps are content-addressed, so this bounds memory, not correctness. */
const MAX_MAPS = 20_000;

/**
 * Serves the dev server's source maps from their own URLs instead of inline.
 * Vite appends every module's map as a base64 data URL, which is ~70% of the
 * bytes a remote browser downloads; browsers fetch a linked map only while
 * DevTools is open. Register after `devCompression` so the slimmer body is
 * what gets compressed.
 */
export function devExternalSourcemaps(
  env: Record<string, string | undefined> = process.env
): Plugin {
  const maps = new Map<string, Buffer>();

  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    if (req.url?.startsWith(PREFIX)) {
      const map = maps.get(req.url.slice(PREFIX.length));
      if (!map) {
        res.statusCode = 404;
        res.end('Source map expired; reload the module');
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'max-age=31536000,immutable');
      res.end(map);
      return;
    }
    linkInlineMaps(res, (map) => {
      const name = `${createHash('sha1').update(map).digest('hex')}.map`;
      maps.delete(name);
      maps.set(name, map);
      if (maps.size > MAX_MAPS) {
        const oldest = maps.keys().next().value;
        if (oldest) maps.delete(oldest);
      }
      return `${PREFIX}${name}`;
    });
    next();
  };

  return {
    name: 'macro-dev-external-sourcemaps',
    apply: (_config, { command, isPreview }) =>
      command === 'serve' &&
      !isPreview &&
      env.MACRO_DEV_INLINE_SOURCEMAPS !== 'true',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

function linkInlineMaps(res: ServerResponse, store: (map: Buffer) => string) {
  const end = res.end;
  // One signature, so TypeScript can resolve `call` with just a body.
  const endWith = end as (this: ServerResponse, body: string) => ServerResponse;
  res.end = function (this: ServerResponse, ...args: unknown[]) {
    res.end = end;
    const [body] = args;
    const text =
      typeof body === 'string'
        ? body
        : Buffer.isBuffer(body)
          ? body.toString('utf8')
          : undefined;
    const match = text === undefined ? null : INLINE_MAP.exec(text);
    if (!text || !match) return end.apply(this, args as Parameters<typeof end>);
    const [inline, comment, base64, close = ''] = match;
    const url = store(Buffer.from(base64 ?? '', 'base64'));
    const linked = `${text.slice(0, text.length - inline.length)}\n${comment}${url}${close}`;
    return endWith.call(this, linked);
  } as typeof end;
}
