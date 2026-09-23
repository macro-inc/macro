import { isAbortError } from './utils';

export type Transition<TPending> = {
  controller: AbortController;
  promise: Promise<void>;
  pending?: TPending;
};

export function createTransitionManager<TTarget, TPending>(callbacks: {
  onSettled: (target: TTarget | undefined, publicStateChanged: boolean) => void;
  onError?: (error: unknown) => void;
}) {
  const transitions = new Map<unknown, Transition<TPending>>();

  return {
    has(key: unknown): boolean {
      return transitions.has(key);
    },

    pending(key: unknown): TPending | undefined {
      return transitions.get(key)?.pending;
    },

    cancel(key: unknown): void {
      transitions.get(key)?.controller.abort();
      transitions.delete(key);
    },

    abortAll(): boolean {
      let hadPending = false;

      for (const transition of transitions.values()) {
        transition.controller.abort();
        hadPending ||= transition.pending !== undefined;
      }
      transitions.clear();

      return hadPending;
    },

    start(
      key: unknown,
      options: {
        controller: AbortController;
        target?: TTarget;
        pending?: TPending;
        run: (transition: Transition<TPending>) => Promise<void>;
        onSettled?: (transition: Transition<TPending>) => boolean;
      }
    ): Promise<void> {
      transitions.get(key)?.controller.abort();

      const transition: Transition<TPending> = {
        controller: options.controller,
        pending: options.pending,
        promise: Promise.resolve(),
      };

      transitions.set(key, transition);
      transition.promise = (async () => {
        try {
          await options.run(transition);
        } catch (error) {
          if (!isAbortError(error, options.controller.signal)) {
            callbacks.onError?.(error);
          }
        } finally {
          if (transitions.get(key) === transition) {
            const publicStateChanged = options.onSettled?.(transition) ?? false;
            transitions.delete(key);
            callbacks.onSettled(options.target, publicStateChanged);
          }
        }
      })();

      return transition.promise;
    },

    promises(): Promise<void>[] {
      return [...transitions.values()].map((transition) => transition.promise);
    },

    get size(): number {
      return transitions.size;
    },
  };
}
