import { createEffect, createRoot, untrack } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { AsHandleMethods, MethodsFor, SurfaceName } from './specs';

/** Cleanup function returned by provide. */
export type Disposer = () => void;

/** Typed handle pinned to an id; method lookups resolve per call. */
export type SurfaceHandle<N extends SurfaceName> = AsHandleMethods<
  MethodsFor<N>
>;

/**
 * Typed method bus for live surface instances, keyed by id alone — the model
 * the block orchestrator has always used (its registry is `setBlocks(id, …)`).
 * CONTRACT: ids are unique across live surfaces. Entity ids are server-issued
 * UUIDs, placeholder ids are `pending-<uuid>`, and app surfaces choose
 * distinctive slugs; the DEV overwrite warn in provide() is the alarm if two
 * providers ever share an id. `N` is a compile-time witness selecting the
 * method map; it is not part of runtime identity.
 */
export type SurfaceDirectory = {
  /**
   * Merge typed methods for `id`. Returns a disposer that removes exactly the
   * methods this call registered (guarded by the registration token below).
   * Later provides win per method name.
   */
  provide<N extends SurfaceName = SurfaceName>(
    id: string,
    methods: Partial<MethodsFor<N>>
  ): Disposer;

  /**
   * Synchronous, infallible, cheap. Pins `id` at creation; each method call
   * bounded-awaits registration (DEFAULT_METHOD_TIMEOUT_MS), then resolves
   * `undefined` as a no-op if the method never arrives.
   */
  handle<N extends SurfaceName = SurfaceName>(id: string): SurfaceHandle<N>;
};

const DEFAULT_AWAIT_TIMEOUT_MS = 5_000;

/** Per-method-call bounded await used by handle(). */
export const DEFAULT_METHOD_TIMEOUT_MS = 10_000;

type RegisteredMethod = {
  fn: (...args: unknown[]) => unknown;
  /** identity of the provide() call that registered it */
  token: symbol;
};

/**
 * Moved verbatim from orchestrator.tsx (createRoot + createEffect + timer;
 * re-checks the condition at timeout before rejecting). Default 5_000ms.
 * Exported so the re-check-at-expiry path can be unit-tested directly
 * (unreachable through the reactive handle) and as the landing spot for
 * orchestrator callers at migration time.
 */
export function awaitCondition(
  condition: () => boolean,
  timeoutMs = DEFAULT_AWAIT_TIMEOUT_MS
): Promise<void> {
  if (condition()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    createRoot((dispose) => {
      const timer = setTimeout(() => {
        if (condition()) return resolve();
        else reject(new Error('Timeout'));
        dispose();
      }, timeoutMs);
      createEffect(() => {
        if (condition()) {
          clearTimeout(timer);
          dispose();
          resolve();
        }
      });
    });
  });
}

function hasRegisteredMethods(
  methods: Record<string, RegisteredMethod | undefined>
): boolean {
  for (const value of Object.values(methods)) {
    if (value !== undefined) return true;
  }
  return false;
}

/**
 * Create an isolated surface directory. Tests use this; the app uses
 * `surfaceDirectory`.
 */
export function createSurfaceDirectory(): SurfaceDirectory {
  const [entries, setEntries] = createStore<
    Record<string, Record<string, RegisteredMethod | undefined> | undefined>
  >({});

  const ensureEntry = (id: string) => {
    if (entries[id] === undefined) {
      setEntries(id, {});
    }
  };

  const prune = (id: string) => {
    const entry = entries[id];
    if (!entry) return;
    if (!hasRegisteredMethods(entry)) {
      setEntries(id, undefined);
    }
  };

  return {
    provide(id, methods) {
      const token = Symbol();
      const registeredNames: string[] = [];
      untrack(() => {
        ensureEntry(id);
        for (const [methodName, fn] of Object.entries(methods)) {
          if (!fn) continue;
          registeredNames.push(methodName);
          if (import.meta.env.DEV) {
            const existing = entries[id]?.[methodName];
            if (existing !== undefined && existing.token !== token) {
              console.warn(`surface method overwritten: ${id}.${methodName}`);
            }
          }
          setEntries(id, methodName, {
            fn: fn as (...args: unknown[]) => unknown,
            token,
          });
        }
      });
      return () => {
        untrack(() => {
          if (entries[id] === undefined) return;
          for (const methodName of registeredNames) {
            setEntries(id, methodName, (current) =>
              current?.token === token ? undefined : current
            );
          }
          prune(id);
        });
      };
    },

    handle(id) {
      return new Proxy({} as SurfaceHandle<SurfaceName>, {
        get(_, prop) {
          if (prop === 'then' || prop === 'catch' || prop === 'finally') {
            return undefined;
          }
          if (typeof prop !== 'string') return undefined;
          return async (...args: unknown[]) => {
            await awaitCondition(
              () => entries[id]?.[prop] !== undefined,
              DEFAULT_METHOD_TIMEOUT_MS
            ).catch(() => {
              if (import.meta.env.DEV) {
                console.warn(`surface method timed out: ${id}.${prop}`);
              }
            });
            const entry = entries[id]?.[prop];
            if (!entry) return undefined;
            return (await entry.fn(...args)) as never;
          };
        },
      });
    },
  };
}

/** The app-wide instance. SurfaceProvider/useSurfaceMethods default to it;
 *  tests build their own via createSurfaceDirectory(). */
export const surfaceDirectory: SurfaceDirectory = createSurfaceDirectory();
