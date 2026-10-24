import { parse, print } from 'graphql';
import { withoutFromCacheFields } from '../exchange/transport-document';
import type { CacheHost } from './types';

const FROM_CACHE = '@fromCache';

/** How an engine built before `@fromCache` rejects documents that use it. */
function isFromCacheUnsupported(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('unsupported directive') &&
    message.includes('`@fromCache`')
  );
}

/**
 * Keeps documents with `@fromCache` fields working on an engine built before
 * the directive: a native app's engine ships with the app, while the web
 * bundle that writes the documents updates on its own, and a dev machine can
 * hold a stale wasm build. The first rejection switches the host to removing
 * those fields before the engine sees them, so such an engine caches the rest
 * of the query and reads the fields as absent, as the server's responses do.
 */
export function withFromCacheFallback(inner: CacheHost): CacheHost {
  let removeFields = false;
  const removed = new Map<string, string>();
  const withoutFields = <Args extends { query: string }>(args: Args): Args => {
    let query = removed.get(args.query);
    if (query === undefined) {
      query = print(withoutFromCacheFields(parse(args.query)));
      removed.set(args.query, query);
    }
    return { ...args, query };
  };
  const call =
    <Args extends { query: string }, Result>(
      run: (args: Args) => Promise<Result>
    ) =>
    async (args: Args): Promise<Result> => {
      if (!args.query.includes(FROM_CACHE)) return run(args);
      if (removeFields) return run(withoutFields(args));
      try {
        return await run(args);
      } catch (error) {
        if (!isFromCacheUnsupported(error)) throw error;
        removeFields = true;
        return run(withoutFields(args));
      }
    };

  // Resolved at call time: hosts and test doubles may omit optional members.
  const readQuery = call((args: Parameters<CacheHost['readQuery']>[0]) =>
    inner.readQuery(args)
  );
  const writeQuery = call((args: Parameters<CacheHost['writeQuery']>[0]) =>
    inner.writeQuery(args)
  );
  const hydrateQuery = call((args: Parameters<CacheHost['hydrateQuery']>[0]) =>
    inner.hydrateQuery(args)
  );
  const watchQuery = call(
    (args: Parameters<NonNullable<CacheHost['watchQuery']>>[0]) =>
      inner.watchQuery?.(args) ??
      Promise.resolve({ kind: 'unsupported' as const })
  );
  return new Proxy(inner, {
    get(target, key, receiver) {
      if (key === 'readQuery') return readQuery;
      if (key === 'writeQuery') return writeQuery;
      if (key === 'hydrateQuery') return hydrateQuery;
      if (key === 'watchQuery') return target.watchQuery && watchQuery;
      return Reflect.get(target, key, receiver);
    },
  });
}
