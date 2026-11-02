import { preloadComponent } from '@app/lib/split-router/router/preload';
import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';

type Options = {
  /** Only modules whose evaluation is safe without mounting or starting workers. */
  components: Readonly<Record<string, unknown>>;
  /** Fixed for this owner; account changes dispose and recreate the scope. */
  userId: string | undefined;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  schedule: (run: () => void) => () => void;
  busy: () => boolean;
};

/** Account-scoped idle code warming. Route/query preloads own all intent data. */
export function createBlockPreloader(options: Options) {
  let disposed = false;
  let started = false;
  let paused = false;
  let recent: string[] = [];
  let views: readonly unknown[] = [];
  let queue: unknown[] = [];
  let cancel: (() => void) | undefined;
  let running = false;
  let scheduleVersion = 0;
  const warmed = new Set<unknown>();
  const storageKey = `block-preloads:${options.userId}`;
  if (options.userId) {
    try {
      const stored: unknown = JSON.parse(
        options.storage.getItem(storageKey) ?? '[]'
      );
      if (Array.isArray(stored))
        recent = stored
          .filter(
            (name): name is string =>
              typeof name === 'string' && name in options.components
          )
          .slice(0, 16);
    } catch {
      // Idle work must also work when storage is unavailable.
    }
  }

  function cancelScheduled() {
    scheduleVersion++;
    cancel?.();
    cancel = undefined;
  }

  function rebuildQueue() {
    queue = [
      ...new Set([
        ...[...recent, ...Object.keys(options.components)].map(
          (name) => options.components[name]
        ),
        ...views,
      ]),
    ].filter((component) => !warmed.has(component));
  }

  function resume() {
    if (
      disposed ||
      !started ||
      !options.userId ||
      running ||
      cancel ||
      !queue.length
    )
      return;
    if (paused || options.busy()) return;
    const version = ++scheduleVersion;
    cancel = options.schedule(() => {
      if (version !== scheduleVersion) return;
      cancel = undefined;
      if (disposed || !started || paused || options.busy()) return;
      const component = queue.shift();
      if (!component) return;
      running = true;
      fireAndForget(warmNext(component), 'block-preload');
    });
  }

  async function warmNext(component: unknown) {
    const span = Telemetry.perfSpan('block.preload.background');
    span.setAttr('preload.queue_remaining', queue.length);
    try {
      warmed.add(component);
      await span.span('block.preload.code', () => preloadComponent(component));
      span.setAttr('preload.outcome', 'settled');
    } catch {
      span.setAttr('preload.outcome', 'failed');
      // Route intent may retry a failed chunk; idle work never loops on it.
    } finally {
      span.end();
      running = false;
      resume();
    }
  }

  return {
    resume,
    pause(value: boolean) {
      paused = value;
      if (paused) cancelScheduled();
      else resume();
    },
    stop() {
      started = false;
      cancelScheduled();
      queue = [];
    },
    remember(type: string) {
      if (disposed || !options.userId || !(type in options.components)) return;
      recent = [type, ...recent.filter((entry) => entry !== type)].slice(0, 16);
      try {
        options.storage.setItem(storageKey, JSON.stringify(recent));
      } catch {}
      rebuildQueue();
    },
    start(backgroundViews: readonly unknown[] = []) {
      if (disposed) return;
      views = backgroundViews;
      started = true;
      rebuildQueue();
      resume();
    },
    dispose() {
      disposed = true;
      cancelScheduled();
      queue = [];
    },
  };
}

export type BlockPreloader = ReturnType<typeof createBlockPreloader>;
