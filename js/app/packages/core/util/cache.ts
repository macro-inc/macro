import { isErr, type MaybeResult, type ObjectLike } from './maybeResult';

interface CacheEntry<E extends string, R extends ObjectLike> {
  result: Promise<MaybeResult<E, R>>;
  expiresAt: number;
}

type CacheOptions =
  | {
      minutes: number;
    }
  | {
      minutes: number;
      seconds?: number;
    }
  | {
      seconds: number;
    }
  | {
      forever: true;
    };

type CachedFunction<Fn extends (...args: any[]) => Promise<any> | (() => any)> =
  Fn & {
    invalidate(...args: Parameters<Fn>): void;
  };

/**
 * Wraps a function that returns a Promise of MaybeResult with caching functionality.
 * The arguments of the function are used as the key for the cache tied to this function.
 *
 * @param fn - The function to be cached
 * @param options - Cache expiration time options (minutes, seconds, or forever)
 * @returns A wrapped function with caching and invalidation capabilities
 *
 * @example
 * interface UserInfo {
 *   authenticated: boolean;
 *   permissions?: string[];
 * }
 *
 * const cachedGetUser = cache(
 *   async (): Promise<MaybeResult<string, UserInfo>> => {
 *     const response = await fetchUser();
 *     if (!response.ok) {
 *       return err('FETCH_ERROR', 'Failed to fetch');
 *     }
 *     return ok({ authenticated: true, permissions: ['read'] });
 *   },
 *   { minutes: 5 }
 * );
 */
export function cache<Fn extends (...args: any[]) => Promise<any>>(
  fn: Fn,
  options: CacheOptions
): CachedFunction<Fn> {
  const cache = new Map<string, CacheEntry<any, any>>();

  const wrappedFn = async (...args: any[]) => {
    const key = hashKey(args);
    const now = Date.now();
    const cached = cache.get(key);
    const forever = 'forever' in options && options.forever;

    if (cached && (forever || now < cached.expiresAt)) {
      return cached.result;
    }

    const result = fn(...args);
    const opt = options as {
      minutes?: number;
      seconds?: number;
    };
    const seconds = (opt.minutes ?? 0) * 60 + (opt.seconds ?? 0);
    const expiresAt = now + seconds * 1000;

    const cacheEntry: CacheEntry<any, any> = {
      result: result as any,
      expiresAt,
    };

    result.then((value) => {
      if (isErr(value)) {
        cache.delete(key);
      }
    });

    cache.set(key, cacheEntry);
    return result;
  };

  Object.defineProperty(wrappedFn, 'invalidate', {
    writable: false,
    value: (...args: any[]) => {
      const key = hashKey(args);
      cache.delete(key);
    },
  });

  return wrappedFn as any;
}

// Modified from the amazing Tanstack Query library (MIT)
// https://github.com/TanStack/query/blob/main/packages/query-core/src/utils.ts#L168
function hashKey<T extends Array<any>>(args: T): string {
  return JSON.stringify(args, (_, val) =>
    isPlainObject(val)
      ? Object.keys(val)
          .sort()
          .reduce((result, key) => {
            result[key] = val[key];
            return result;
          }, {} as any)
      : val
  );
}

function isPlainObject(obj: any): boolean {
  if (obj == null || typeof obj !== 'object') return false;
  const proto = Object.getPrototypeOf(obj);
  return proto === null || proto === Object.prototype;
}
