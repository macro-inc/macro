import type { MediaType } from './io';

export interface NativeUploadResult {
  id: string;
  url: string;
}

interface NativeUploadCallbacks {
  start(): void;
  success(result: NativeUploadResult): void;
  failure(): void;
  cancelled(): void;
}

/** One surface's real upload operations and their component subscriptions. */
export function createNativeMediaUploadEvents() {
  const pending = new Set<string>();
  const listeners = new Map<string, Set<NativeUploadCallbacks>>();
  let disposed = false;

  const keyFor = (kind: MediaType, generation: number, localUrl: string) =>
    `${kind}:${generation}:${localUrl}`;

  function notify(
    key: string,
    call: (listener: NativeUploadCallbacks) => void
  ): void {
    for (const listener of listeners.get(key) ?? []) call(listener);
  }

  return {
    pending: (kind: MediaType, generation: number, localUrl: string) =>
      pending.has(keyFor(kind, generation, localUrl)),
    subscribe(
      kind: MediaType,
      generation: number,
      localUrl: string,
      callbacks: NativeUploadCallbacks
    ) {
      const key = keyFor(kind, generation, localUrl);
      if (disposed) throw new Error('Native media uploads are disposed');
      const current = listeners.get(key) ?? new Set();
      current.add(callbacks);
      listeners.set(key, current);
      return () => {
        current.delete(callbacks);
        if (current.size === 0 && listeners.get(key) === current)
          listeners.delete(key);
      };
    },
    async track(
      kind: MediaType,
      generation: number,
      localUrl: string,
      upload: () => Promise<NativeUploadResult | undefined>
    ): Promise<void> {
      const key = keyFor(kind, generation, localUrl);
      if (disposed) throw new Error('Native media uploads are disposed');
      if (pending.has(key))
        throw new Error('Native media upload already tracked');
      pending.add(key);
      try {
        notify(key, (listener) => listener.start());
        let result: NativeUploadResult | undefined;
        try {
          result = await upload();
        } catch (error) {
          notify(key, (listener) => listener.failure());
          throw error;
        }
        if (result) notify(key, (listener) => listener.success(result));
        else notify(key, (listener) => listener.cancelled());
      } finally {
        pending.delete(key);
      }
    },
    dispose() {
      disposed = true;
      pending.clear();
      listeners.clear();
    },
  };
}
