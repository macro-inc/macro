import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';

type Observation = { time: number; rect?: DOMRectReadOnly };

type Target = {
  publish: (visible: boolean) => void;
  registeredAt: number;
  viewport?: Observation;
  scroller?: Observation;
  refreshing?: boolean;
};

// Avoid counting edge contact as seeing a message, including very tall replies.
const INTERSECTION_THRESHOLD = 0.001;

/** What one observer saw of a message; no rectangle when it was not visible. */
function observationOf(entry: IntersectionObserverEntry): Observation {
  return {
    time: entry.time,
    rect:
      entry.isIntersecting && entry.intersectionRatio >= INTERSECTION_THRESHOLD
        ? entry.intersectionRect
        : undefined,
  };
}

/** Whether two rectangles from the same rendering update overlap. */
function rectsOverlap(
  a: DOMRectReadOnly | undefined,
  b: DOMRectReadOnly | undefined
) {
  return (
    !!a &&
    !!b &&
    Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) &&
    Math.min(a.right, b.right) > Math.max(a.left, b.left)
  );
}

/** Share observers across a message list; never infer visibility from mounting. */
export function createMessageReadVisibility(options: {
  root: Accessor<Element | null | undefined>;
  insets: Accessor<{ start: number; end: number }>;
}) {
  const targets = new Map<Element, Target>();
  const [foreground, setForeground] = createSignal(!document.hidden);
  const onVisibilityChange = () => setForeground(!document.hidden);
  document.addEventListener('visibilitychange', onVisibilityChange);
  onCleanup(() =>
    document.removeEventListener('visibilitychange', onVisibilityChange)
  );

  let viewportObserver: IntersectionObserver | undefined;
  let scrollerObserver: IntersectionObserver | undefined;
  createEffect(
    on(
      [
        options.root,
        () => options.insets().start,
        () => options.insets().end,
        foreground,
      ],
      ([root, start, end, visible]) => {
        if (
          !visible ||
          root === undefined ||
          typeof IntersectionObserver === 'undefined'
        )
          return;
        let active = true;
        const reobserve = (
          element: Element,
          observers: (IntersectionObserver | undefined)[]
        ) => {
          for (const observer of observers) observer?.unobserve(element);
          for (const observer of observers) observer?.observe(element);
        };
        const publishTarget = (element: Element, target: Target) => {
          const viewportObservation = target.viewport;
          const scrollerObservation = root
            ? target.scroller
            : viewportObservation;
          if (!viewportObservation || !scrollerObservation) {
            target.publish(false);
            return;
          }
          if (viewportObservation.time !== scrollerObservation.time) {
            target.publish(false);
            // Only one observer may cross a threshold during a scroll. Get
            // both rectangles from the same rendering update before clipping
            // them, rather than combining new and old screen coordinates.
            if (!target.refreshing) {
              target.refreshing = true;
              target.viewport = undefined;
              target.scroller = undefined;
              reobserve(element, [viewportObserver, scrollerObserver]);
            }
            return;
          }
          target.refreshing = false;
          target.publish(
            rectsOverlap(viewportObservation.rect, scrollerObservation.rect)
          );
        };
        const update = (
          entries: IntersectionObserverEntry[],
          kind: 'viewport' | 'scroller'
        ) => {
          if (!active) return;
          for (const entry of entries) {
            const target = targets.get(entry.target);
            if (!target) continue;
            if (entry.time <= target.registeredAt) {
              // unobserve() does not discard queued entries from an old batch.
              // Reobserve also handles a new registration in the current frame.
              reobserve(entry.target, [
                kind === 'viewport' ? viewportObserver : scrollerObserver,
              ]);
              continue;
            }
            target[kind] = observationOf(entry);
            publishTarget(entry.target, target);
          }
        };
        // The implicit root also clips against the window and every ancestor.
        // An explicit scroll root alone can intersect while its pane is offscreen.
        viewportObserver = new IntersectionObserver(
          (entries) => update(entries, 'viewport'),
          {
            threshold: INTERSECTION_THRESHOLD,
          }
        );
        if (root) {
          scrollerObserver = new IntersectionObserver(
            (entries) => update(entries, 'scroller'),
            {
              root,
              rootMargin: `${-Math.max(0, start)}px 0px ${-Math.max(0, end)}px 0px`,
              threshold: INTERSECTION_THRESHOLD,
            }
          );
        }
        for (const element of targets.keys()) {
          viewportObserver.observe(element);
          scrollerObserver?.observe(element);
        }
        onCleanup(() => {
          active = false;
          viewportObserver?.disconnect();
          scrollerObserver?.disconnect();
          viewportObserver = undefined;
          scrollerObserver = undefined;
          for (const target of targets.values()) {
            target.viewport = undefined;
            target.scroller = undefined;
            target.refreshing = false;
            target.publish(false);
          }
        });
      }
    )
  );

  return {
    observe(element: Element, publish: Target['publish']) {
      const target: Target = { publish, registeredAt: performance.now() };
      targets.set(element, target);
      viewportObserver?.observe(element);
      scrollerObserver?.observe(element);
      return () => {
        if (targets.get(element) !== target) return;
        viewportObserver?.unobserve(element);
        scrollerObserver?.unobserve(element);
        targets.delete(element);
        publish(false);
      };
    },
  };
}
