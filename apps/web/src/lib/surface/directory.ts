import { createEffect, createRoot, untrack } from 'solid-js';
import { createStore } from 'solid-js/store';
import type {
  AsHandleMethods,
  AsProvidedMethods,
  MethodsFor,
  SurfaceName,
} from './specs';

/** Composite key identifying a live surface instance. */
export type SurfaceKey = `${SurfaceName}:${string}`;

/** Build the directory key for `(name, id)`. */
export const surfaceKey = (name: SurfaceName, id: string): SurfaceKey =>
  `${name}:${id}`;

/** Cleanup function returned by announce/provide. */
export type Disposer = () => void;

/** Typed handle pinned to a `(name, id)` pair; method lookups resolve per call. */
export type SurfaceHandle<N extends SurfaceName> = {
  readonly surface: { readonly name: N; readonly id: string };
} & AsHandleMethods<MethodsFor<N>>;

/** Options for a handle's per-call bounded await. */
export type SurfaceHandleOptions = {
  /** Per-method-call bounded await. Default DEFAULT_METHOD_TIMEOUT_MS. */
  timeoutMs?: number;
};

/** Runtime registry of live surface instances and their public methods. */
export type SurfaceDirectory = {
  /**
   * Declare that a live, non-nested instance of (name, id) exists.
   * Returns a disposer. Refcounted (§3.5).
   */
  announce(name: SurfaceName, id: string): Disposer;

  /**
   * Merge typed methods for (name, id). Independent of announce — neither
   * requires the other, in either order. Returns a disposer that removes
   * exactly the methods this call registered, guarded by registration
   * identity (§3.6). Later provides win per method name.
   */
  provide<N extends SurfaceName>(
    name: N,
    id: string,
    methods: AsProvidedMethods<MethodsFor<N>> // every key optional by construction
  ): Disposer;

  /**
   * Synchronous, infallible, cheap. Pins (name, id) at creation; resolves
   * registrations lazily at each method call (§3.7).
   */
  handle<N extends SurfaceName>(
    name: N,
    id: string,
    options?: SurfaceHandleOptions
  ): SurfaceHandle<N>;

  /** Reactive: true while announce-count > 0 for (name, id). */
  isLive(name: SurfaceName, id: string): boolean;
};

const DEFAULT_AWAIT_TIMEOUT_MS = 5_000;

/** Per-method-call bounded await used when the caller does not pass timeoutMs. */
export const DEFAULT_METHOD_TIMEOUT_MS = 10_000;

type RegisteredMethod = {
  fn: (...args: unknown[]) => unknown;
  /** identity of the provide() call that registered it */
  token: symbol;
};
type DirectoryEntry = {
  announceCount: number;
  methods: Record<string, RegisteredMethod | undefined>;
};

/**
 * Moved verbatim from orchestrator.tsx (createRoot + createEffect + timer;
 * re-checks the condition at timeout before rejecting). Default 5_000ms.
 * Exported because features use it directly (e.g. NewChannelBlockAdapter's
 * messagesHandle wait).
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

function hasRegisteredMethods(entry: DirectoryEntry): boolean {
  for (const value of Object.values(entry.methods)) {
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
    Record<SurfaceKey, DirectoryEntry | undefined>
  >({});

  const ensureEntry = (key: SurfaceKey) => {
    if (entries[key] === undefined) {
      setEntries(key, { announceCount: 0, methods: {} });
    }
  };

  const prune = (key: SurfaceKey) => {
    const entry = entries[key];
    if (!entry) return;
    if (entry.announceCount === 0 && !hasRegisteredMethods(entry)) {
      setEntries(key, undefined);
    }
  };

  return {
    announce(name, id) {
      const key = surfaceKey(name, id);
      // Registry mutations must not subscribe the caller's effect (provider
      // announce/provide effects would loop on their own store writes).
      untrack(() => {
        const current = entries[key];
        if (current === undefined) {
          setEntries(key, { announceCount: 1, methods: {} });
          return;
        }
        setEntries(key, 'announceCount', (count) => {
          const next = count + 1;
          if (import.meta.env.DEV && next > 1) {
            console.warn(
              `two live mounts share \`${key}\`; expected only transiently during a remount in the same tick`
            );
          }
          return next;
        });
      });
      return () => {
        untrack(() => {
          const entry = entries[key];
          if (entry === undefined) return;
          const next = Math.max(0, entry.announceCount - 1);
          if (next === 0 && !hasRegisteredMethods(entry)) {
            setEntries(key, undefined);
            return;
          }
          setEntries(key, 'announceCount', next);
        });
      };
    },

    provide(name, id, methods) {
      const key = surfaceKey(name, id);
      const token = Symbol();
      const registeredNames: string[] = [];
      untrack(() => {
        ensureEntry(key);
        for (const [methodName, fn] of Object.entries(methods)) {
          if (!fn) continue;
          registeredNames.push(methodName);
          if (import.meta.env.DEV) {
            const existing = entries[key]?.methods[methodName];
            if (existing !== undefined && existing.token !== token) {
              console.warn(`surface method overwritten: ${key}.${methodName}`);
            }
          }
          setEntries(key, 'methods', methodName, {
            fn: fn as (...args: unknown[]) => unknown,
            token,
          });
        }
      });
      return () => {
        untrack(() => {
          if (entries[key] === undefined) return;
          for (const methodName of registeredNames) {
            setEntries(key, 'methods', methodName, (current) =>
              current?.token === token ? undefined : current
            );
          }
          prune(key);
        });
      };
    },

    handle(name, id, options) {
      const key = surfaceKey(name, id);
      const timeoutMs = options?.timeoutMs ?? DEFAULT_METHOD_TIMEOUT_MS;
      const surface = { name, id };
      return new Proxy({} as SurfaceHandle<typeof name>, {
        get(_, prop) {
          if (prop === 'surface') return surface;
          if (prop === 'then' || prop === 'catch' || prop === 'finally') {
            return undefined;
          }
          if (typeof prop !== 'string') return undefined;
          return async (...args: unknown[]) => {
            await awaitCondition(
              () => entries[key]?.methods[prop] !== undefined,
              timeoutMs
            ).catch(() => {
              if (import.meta.env.DEV) {
                console.warn(`surface method timed out: ${key}.${prop}`);
              }
            });
            const entry = entries[key]?.methods[prop];
            if (!entry) return undefined;
            return (await entry.fn(...args)) as never;
          };
        },
      });
    },

    isLive(name, id) {
      return (entries[surfaceKey(name, id)]?.announceCount ?? 0) > 0;
    },
  };
}

/** The app-wide instance. SurfaceProvider/useSurfaceMethods default to it;
 *  tests build their own via createSurfaceDirectory(). */
export const surfaceDirectory: SurfaceDirectory = createSurfaceDirectory();
