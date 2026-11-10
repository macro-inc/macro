import { createHash } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import type { Connect, Plugin } from 'vite';

const PREFIX = '/@macro-sourcemap/';
const MAP_COMMENTS = ['\n//# sourceMappingURL=', '\n/*# sourceMappingURL='];
const DATA_PREFIXES = [
  'data:application/json;charset=utf-8;base64,',
  'data:application/json;base64,',
];
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
    const inline = text === undefined ? undefined : findInlineMap(text);
    if (!text || !inline) return end.apply(this, args as Parameters<typeof end>);
    const url = store(Buffer.from(inline.base64, 'base64'));
    const linked = `${text.slice(0, inline.start)}${inline.comment}${url}${inline.close}`;
    return endWith.call(this, linked);
  } as typeof end;
}

type InlineMap = {
  /** Where the map comment starts, at its leading newline. */
  start: number;
  comment: string;
  base64: string;
  close: string;
};

/**
 * The module's trailing inline source map, found by string search: a regex
 * over a multi-megabyte module (a large generated client) overflows V8's
 * regex stack.
 */
export function findInlineMap(text: string): InlineMap | undefined {
  for (const comment of MAP_COMMENTS) {
    const start = text.lastIndexOf(comment);
    if (start < 0) continue;
    let rest = text.slice(start + comment.length);
    const prefix = DATA_PREFIXES.find((candidate) =>
      rest.startsWith(candidate)
    );
    if (!prefix) continue;
    rest = rest.slice(prefix.length).trimEnd();
    const close = rest.endsWith(' */') ? ' */' : '';
    const base64 = close ? rest.slice(0, -close.length) : rest;
    if (base64 === '' || !isBase64(base64)) continue;
    return { start, comment, base64, close };
  }
  return undefined;
}

function isBase64(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    const ok =
      (code >= 65 && code <= 90) || // A-Z
      (code >= 97 && code <= 122) || // a-z
      (code >= 48 && code <= 57) || // 0-9
      code === 43 || // +
      code === 47 || // /
      code === 61; // =
    if (!ok) return false;
  }
  return true;
}
