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
              const observer =
                kind === 'viewport' ? viewportObserver : scrollerObserver;
              observer?.unobserve(entry.target);
              observer?.observe(entry.target);
              continue;
            }
            target[kind] = {
              time: entry.time,
              rect:
                entry.isIntersecting &&
                entry.intersectionRatio >= INTERSECTION_THRESHOLD
                  ? entry.intersectionRect
                  : undefined,
            };
            const viewportObservation = target.viewport;
            const scrollerObservation = root
              ? target.scroller
              : viewportObservation;
            if (!viewportObservation || !scrollerObservation) {
              target.publish(false);
              continue;
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
                viewportObserver?.unobserve(entry.target);
                scrollerObserver?.unobserve(entry.target);
                viewportObserver?.observe(entry.target);
                scrollerObserver?.observe(entry.target);
              }
              continue;
            }
            target.refreshing = false;
            const viewport = viewportObservation.rect;
            const scroller = scrollerObservation.rect;
            target.publish(
              !!viewport &&
                !!scroller &&
                Math.min(viewport.bottom, scroller.bottom) >
                  Math.max(viewport.top, scroller.top) &&
                Math.min(viewport.right, scroller.right) >
                  Math.max(viewport.left, scroller.left)
            );
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
