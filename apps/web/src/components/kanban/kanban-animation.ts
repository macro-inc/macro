export type KanbanAnimationItem = {
  /** Unique placement, including the lane for cards with several placements. */
  key: string;
  /** Shared identity lets a card animate across remounted placements. */
  identity?: string;
  placeholder?: boolean;
  parentKey?: string;
  element: HTMLElement;
  /** Unanimated positioning wrapper, used for stable virtualized measurements. */
  layout: HTMLElement;
};

type Snapshot = KanbanAnimationItem & {
  rect: DOMRect;
  clone?: HTMLElement;
};

const DURATION = 200;
const TIMING: KeyframeAnimationOptions = {
  duration: DURATION,
  easing: 'cubic-bezier(0.2, 0, 0, 1)',
};

/** Observe layout during a drag hover or host-owned move, never ordinary paging. */
export function createKanbanAnimation(options: {
  viewport(): HTMLElement | undefined;
  items(): KanbanAnimationItem[];
}) {
  let snapshots = new Map<string, Snapshot>();
  let observer: MutationObserver | undefined;
  let frame: number | undefined;
  let moves = 0;
  let hovering = false;
  let generation = 0;
  const animations = new Set<Animation>();
  const activeElements = new Map<HTMLElement, Animation>();
  const ghosts = new Set<HTMLElement>();
  const movingIdentities = new Set<string>();
  const destinations = new Map<string, string>();
  const flights = new Map<string, HTMLElement>();

  const reducedMotion = () =>
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  function clearAnimations() {
    for (const animation of animations) {
      animation.cancel();
    }

    animations.clear();
    activeElements.clear();

    for (const ghost of ghosts) {
      ghost.remove();
    }

    ghosts.clear();
    flights.clear();
  }

  function capture() {
    const viewport = options.viewport();
    const result = new Map<string, Snapshot>();

    if (!viewport) {
      return result;
    }

    const bounds = viewport.getBoundingClientRect();
    const items = options.items();
    const byKey = new Map(items.map((item) => [item.key, item]));

    for (const item of items) {
      const rect = normalizedRect(item, byKey);

      if (
        rect.width === 0 ||
        rect.height === 0 ||
        rect.right <= bounds.left ||
        rect.left >= bounds.right ||
        rect.bottom <= bounds.top ||
        rect.top >= bounds.bottom
      ) {
        continue;
      }

      result.set(item.key, {
        ...item,
        rect,
        clone:
          (item.placeholder && hovering) ||
          (item.identity && movingIdentities.has(item.identity))
            ? (item.element.cloneNode(true) as HTMLElement)
            : undefined,
      });
    }

    return result;
  }

  // A wrapper inherits every animated ancestor, although it has no local animation.
  function normalizedRect(
    item: KanbanAnimationItem,
    byKey: Map<string, KanbanAnimationItem>
  ): DOMRect {
    const rect = item.layout.getBoundingClientRect();
    let x = rect.left;
    let y = rect.top;
    let parentKey = item.parentKey;
    const seen = new Set<string>();

    while (parentKey && !seen.has(parentKey)) {
      seen.add(parentKey);
      const parent = byKey.get(parentKey);
      if (!parent) {
        break;
      }

      if (activeElements.has(parent.element)) {
        const layout = parent.layout.getBoundingClientRect();
        const visible = parent.element.getBoundingClientRect();
        x -= visible.left - layout.left;
        y -= visible.top - layout.top;
      }
      parentKey = parent.parentKey;
    }

    return new DOMRect(x, y, rect.width, rect.height);
  }

  function residuals(items: Map<string, Snapshot>) {
    const result = new Map<string, { x: number; y: number }>();
    for (const item of items.values()) {
      if (!activeElements.has(item.element) || !item.element.isConnected) {
        continue;
      }
      const layout = item.layout.getBoundingClientRect();
      const visible = item.element.getBoundingClientRect();
      result.set(item.key, {
        x: visible.left - layout.left,
        y: visible.top - layout.top,
      });
    }
    return result;
  }

  function totalResidual(
    item: Snapshot,
    values: Map<string, { x: number; y: number }>,
    items: Map<string, Snapshot>
  ) {
    let x = 0;
    let y = 0;
    let key: string | undefined = item.key;
    const seen = new Set<string>();
    while (key && !seen.has(key)) {
      seen.add(key);
      const value = values.get(key);
      x += value?.x ?? 0;
      y += value?.y ?? 0;
      key = items.get(key)?.parentKey;
    }
    return { x, y };
  }

  function animate(
    element: HTMLElement,
    keyframes: Keyframe[],
    done?: () => void
  ) {
    if (!element.animate) {
      done?.();
      return;
    }

    const animation = element.animate(keyframes, TIMING);
    animations.add(animation);
    activeElements.set(element, animation);
    animation.finished.then(
      () => {
        animations.delete(animation);
        if (activeElements.get(element) === animation)
          activeElements.delete(element);
        done?.();
      },
      () => {
        animations.delete(animation);
        if (activeElements.get(element) === animation)
          activeElements.delete(element);
        done?.();
      }
    );
  }

  function fly(
    from: Snapshot,
    to: Snapshot,
    start?: { rect: DOMRect; clone: HTMLElement; opacity: string },
    placeholder = false
  ) {
    const ghost = start?.clone ?? from.clone;
    if (!ghost) {
      return;
    }

    const rect = start?.rect ?? from.rect;
    const opacity = start?.opacity ?? '1';
    ghost.inert = true;
    ghost.setAttribute('aria-hidden', 'true');
    ghost.removeAttribute('id');

    for (const child of ghost.querySelectorAll('[id]')) {
      child.removeAttribute('id');
    }

    Object.assign(ghost.style, {
      position: 'fixed',
      pointerEvents: 'none',
      margin: '0',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      zIndex: '1000',
      opacity,
    });
    document.body.append(ghost);
    ghosts.add(ghost);
    if (placeholder) {
      flights.set(to.key, ghost);
    }
    animate(
      ghost,
      [
        { transform: 'translate(0, 0)', opacity: Number(opacity) },
        {
          transform: `translate(${to.rect.left - rect.left}px, ${to.rect.top - rect.top}px)`,
          opacity: 0,
        },
      ],
      () => {
        ghost.remove();
        ghosts.delete(ghost);
        if (flights.get(to.key) === ghost) {
          flights.delete(to.key);
        }
      }
    );
    animate(to.element, [{ opacity: 0 }, { opacity: 1 }]);
  }

  function play() {
    frame = undefined;
    const next = capture();
    const changed =
      next.size !== snapshots.size ||
      [...next.values()].some((item) => {
        const previous = snapshots.get(item.key);
        return (
          !previous ||
          previous.rect.left !== item.rect.left ||
          previous.rect.top !== item.rect.top
        );
      });

    if (!changed) {
      snapshots = next;
      if (!hovering && moves === 0) disconnect();
      return;
    }

    // Sample every active element and ghost before cancelling any animation.
    const residual = residuals(snapshots);
    const flightStarts = new Map<
      string,
      {
        rect: DOMRect;
        clone: HTMLElement;
        opacity: string;
      }
    >();
    for (const [key, ghost] of flights) {
      const rect = ghost.getBoundingClientRect();
      flightStarts.set(key, {
        rect:
          rect.width && rect.height
            ? rect
            : new DOMRect(
                Number.parseFloat(ghost.style.left),
                Number.parseFloat(ghost.style.top),
                Number.parseFloat(ghost.style.width),
                Number.parseFloat(ghost.style.height)
              ),
        clone: ghost.cloneNode(true) as HTMLElement,
        opacity: getComputedStyle(ghost).opacity || ghost.style.opacity || '1',
      });
    }
    clearAnimations();

    if (!reducedMotion()) {
      const removed = [...snapshots.values()].filter(
        (item) => !next.has(item.key)
      );
      const used = new Set<Snapshot>();
      const displacement = (item: Snapshot, previous: Snapshot) => {
        const remaining = totalResidual(previous, residual, snapshots);
        return {
          x: previous.rect.left + remaining.x - item.rect.left,
          y: previous.rect.top + remaining.y - item.rect.top,
        };
      };

      for (const item of next.values()) {
        const previous = snapshots.get(item.key);
        if (item.placeholder && previous && flightStarts.has(item.key)) {
          fly(previous, item, flightStarts.get(item.key), true);
          continue;
        }

        if (!previous) {
          if (item.placeholder && hovering) {
            const source = removed.find(
              (candidate) => candidate.placeholder && !used.has(candidate)
            );
            if (source) {
              fly(source, item, flightStarts.get(source.key), true);
              used.add(source);
            } else {
              animate(item.element, [{ opacity: 0 }, { opacity: 1 }]);
            }
          }
          const source = item.identity
            ? removed.find(
                (candidate) =>
                  candidate.identity === item.identity && !used.has(candidate)
              )
            : undefined;
          if (
            source &&
            (!destinations.has(item.identity!) ||
              item.parentKey === destinations.get(item.identity!))
          ) {
            fly(source, item);
            used.add(source);
          }
          continue;
        }

        const total = displacement(item, previous);
        const oldParent = item.parentKey
          ? snapshots.get(item.parentKey)
          : undefined;
        const newParent = item.parentKey ? next.get(item.parentKey) : undefined;
        const parent =
          oldParent && newParent
            ? displacement(newParent, oldParent)
            : { x: 0, y: 0 };
        const x = total.x - parent.x;
        const y = total.y - parent.y;

        if (Math.abs(x) < 1 && Math.abs(y) < 1) {
          continue;
        }

        animate(item.element, [
          { transform: `translate(${x}px, ${y}px)` },
          { transform: 'translate(0, 0)' },
        ]);
      }

      // A removed placement can merge into an already mounted destination.
      for (const source of removed) {
        if (!source.identity || used.has(source)) {
          continue;
        }
        const destinationKey = destinations.get(source.identity);
        if (!destinationKey) {
          continue;
        }
        const target = [...next.values()].find(
          (item) =>
            item.identity === source.identity &&
            item.parentKey === destinationKey
        );
        if (target) {
          fly(source, target);
          used.add(source);
        }
      }
    }

    snapshots = next;
    if (!hovering && moves === 0) disconnect();
  }

  function schedule() {
    if (frame !== undefined) {
      return;
    }

    frame = requestAnimationFrame(play);
  }

  // Scrolling and fresh pointer interactions must not animate virtualized mounts.
  function resetLayout() {
    if (frame !== undefined) {
      cancelAnimationFrame(frame);
      frame = undefined;
    }

    clearAnimations();
    snapshots.clear();
    schedule();
  }

  function disconnect() {
    observer?.disconnect();
    observer = undefined;
    const viewport = options.viewport();
    viewport?.removeEventListener('scroll', resetLayout, true);
    viewport?.removeEventListener('pointerdown', resetLayout, true);
  }

  function cancel() {
    generation += 1;
    moves = 0;
    disconnect();

    if (frame !== undefined) {
      cancelAnimationFrame(frame);
      frame = undefined;
    }

    clearAnimations();
    snapshots.clear();
    movingIdentities.clear();
    destinations.clear();
    hovering = false;
  }

  function observe(viewport: HTMLElement) {
    observer = new MutationObserver(schedule);
    observer.observe(viewport, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['style'],
    });
    viewport.addEventListener('scroll', resetLayout, true);
    viewport.addEventListener('pointerdown', resetLayout, true);
  }

  function beginHover() {
    const viewport = options.viewport();
    if (!viewport || reducedMotion() || hovering) return () => {};

    hovering = true;
    if (moves === 0) {
      movingIdentities.clear();
      destinations.clear();
      snapshots = capture();
      if (!observer) observe(viewport);
    }
    const started = generation;
    return () => {
      if (generation !== started) return;
      hovering = false;
      schedule();
    };
  }

  function begin(identity: string, destinationParentKey?: string) {
    const viewport = options.viewport();

    if (!viewport || reducedMotion()) {
      return () => {};
    }

    if (moves === 0 && !observer) {
      movingIdentities.clear();
      destinations.clear();
      movingIdentities.add(identity);
      snapshots = capture();
      observe(viewport);
    }

    if (!movingIdentities.has(identity)) {
      movingIdentities.add(identity);

      // Retain the current first frame for other pending moves.
      for (const item of capture().values()) {
        if (item.identity === identity) {
          snapshots.set(item.key, item);
        }
      }
    }

    if (destinationParentKey) {
      destinations.set(identity, destinationParentKey);
    }
    moves += 1;
    const started = generation;
    let finished = false;

    return () => {
      if (finished || generation !== started) {
        return;
      }

      finished = true;
      moves -= 1;
      schedule();

      if (moves === 0 && !hovering) {
        disconnect();
      }
    };
  }

  return { begin, beginHover, cancel };
}
