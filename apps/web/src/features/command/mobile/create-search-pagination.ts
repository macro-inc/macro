import { fireAndForget } from '@core/util/fireAndForget';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import { type Accessor, createEffect, on, onCleanup } from 'solid-js';

/** Fill short pages as well as paging on scroll, without retrying a failed page in a loop. */
export function createSearchPagination<T>(options: {
  items: Accessor<readonly T[]>;
  container: Accessor<HTMLElement | undefined>;
  remaining: Accessor<number | undefined>;
  hasMore: Accessor<boolean>;
  busy: Accessor<boolean>;
  loadMore: () => Promise<unknown>;
}) {
  let disposed = false;
  let queued = false;
  let lastAutoPage: readonly T[] | undefined;
  onCleanup(() => {
    disposed = true;
  });

  const loadNearEnd = (automatic = false) => {
    if (disposed || !options.hasMore() || options.busy()) return;
    const remaining = options.remaining();
    if (remaining === undefined || remaining > 44 * 3) return;
    const page = options.items();
    if (automatic && page === lastAutoPage) return;
    lastAutoPage = page;
    fireAndForget(options.loadMore(), 'mobile-search');
  };

  // DOM measurements settle after rendering and ResizeObserver updates. A new
  // result array allows another automatic page; a failed/no-op fetch does not.
  const scheduleCheck = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      loadNearEnd(true);
    });
  };
  createResizeObserver(options.container, scheduleCheck);
  createEffect(
    on([options.items, options.hasMore, options.busy], scheduleCheck)
  );
  return () => loadNearEnd();
}
