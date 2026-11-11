import type { DecoratorUploadCallbacks } from '../../context/DecoratorHostContext';

/** One surface's real upload operations and their component subscriptions. */
export function createNativeMediaUploadEvents() {
  const pending = new Set<string>();
  const listeners = new Map<string, Set<DecoratorUploadCallbacks>>();
  let disposed = false;

  function emit(localUrl: string, phase: keyof DecoratorUploadCallbacks): void {
    for (const listener of listeners.get(localUrl) ?? []) listener[phase]();
  }

  return {
    pending: (localUrl: string) => pending.has(localUrl),
    subscribe(localUrl: string, callbacks: DecoratorUploadCallbacks) {
      if (disposed) throw new Error('Native media uploads are disposed');
      const current = listeners.get(localUrl) ?? new Set();
      current.add(callbacks);
      listeners.set(localUrl, current);
      return () => {
        current.delete(callbacks);
        if (current.size === 0 && listeners.get(localUrl) === current)
          listeners.delete(localUrl);
      };
    },
    async track(
      localUrl: string,
      upload: () => Promise<boolean>
    ): Promise<void> {
      if (disposed) throw new Error('Native media uploads are disposed');
      if (pending.has(localUrl))
        throw new Error('Native media upload already tracked');
      pending.add(localUrl);
      try {
        emit(localUrl, 'start');
        let committed: boolean;
        try {
          committed = await upload();
        } catch (error) {
          emit(localUrl, 'failure');
          throw error;
        }
        emit(localUrl, committed ? 'success' : 'failure');
      } finally {
        pending.delete(localUrl);
      }
    },
    dispose() {
      disposed = true;
      pending.clear();
      listeners.clear();
    },
  };
}
