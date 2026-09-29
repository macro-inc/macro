import { createSignal, onCleanup } from 'solid-js';

/**
 * Where a target may be found. `view` targets resolve only inside the tour's
 * boundary (its split pane), so two splits showing the same view never
 * highlight each other's controls. `app` targets are shared chrome, such as
 * the sidebar create menu, and resolve anywhere.
 */
export type TourTargetScope = 'view' | 'app';

declare const tourTargetBrand: unique symbol;

/**
 * A named element a tour step can point at. Only `defineTourTargets` creates
 * these, so every target has a `namespace.name` id and a declared scope.
 */
export type TourTarget = {
  readonly id: `${string}.${string}`;
  readonly scope: TourTargetScope;
  readonly [tourTargetBrand]: true;
};

/**
 * Declares the targets a feature exposes to tours.
 *
 * @example
 * export const CALENDAR_TOUR = defineTourTargets('calendar', ['period', 'grid']);
 * <div ref={tourTarget(CALENDAR_TOUR.period)} />
 */
export function defineTourTargets<const Name extends string>(
  namespace: string,
  names: readonly Name[],
  options: { scope?: TourTargetScope } = {}
): { readonly [K in Name]: TourTarget } {
  const scope = options.scope ?? 'view';
  return Object.fromEntries(
    names.map((name) => [
      name,
      { id: `${namespace}.${name}`, scope } as unknown as TourTarget,
    ])
  ) as { readonly [K in Name]: TourTarget };
}

const elements = new Map<string, Set<HTMLElement>>();
const [version, setVersion] = createSignal(0);
const bump = () => setVersion((value) => value + 1);

// Targets appear and disappear through layout too (a sidebar expanding from
// zero width), so size changes of registered elements re-resolve. Only
// registered elements are observed.
let sizes: ResizeObserver | undefined;
const observeSize = (element: HTMLElement) => {
  if (typeof ResizeObserver === 'undefined') return;
  sizes ??= new ResizeObserver(bump);
  sizes.observe(element);
};

function register(target: TourTarget, element: HTMLElement) {
  let set = elements.get(target.id);
  if (!set) {
    set = new Set();
    elements.set(target.id, set);
  }
  set.add(element);
  observeSize(element);
  bump();
  // Refs run before the element is inserted; resolve again once it is.
  queueMicrotask(bump);
  return () => {
    set.delete(element);
    if (!set.size) elements.delete(target.id);
    sizes?.unobserve(element);
    bump();
  };
}

/**
 * A ref that registers the element as `target` for as long as the owning
 * component is mounted. Call it in JSX: `ref={tourTarget(TARGETS.name)}`.
 */
export function tourTarget(target: TourTarget) {
  let unregister: (() => void) | undefined;
  onCleanup(() => unregister?.());
  return (element: HTMLElement) => {
    unregister?.();
    unregister = register(target, element);
  };
}

const isShown = (element: HTMLElement) => {
  if (!element.isConnected) return false;
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) return false;
  return !element.closest('[hidden], [inert], [aria-hidden="true"]');
};

/**
 * The element for the first of `targets` that has one shown (inside
 * `boundary` for view-scoped targets); the top-most when several share it. Reruns in a tracked scope when
 * a target registers, unregisters, or resizes.
 */
export function resolveTourTarget(
  targets: readonly TourTarget[],
  boundary: HTMLElement | undefined
): HTMLElement | undefined {
  return matchTourTarget(targets, boundary)?.element;
}

/** Like `resolveTourTarget`, but also says which of `targets` matched. */
export function matchTourTarget(
  targets: readonly TourTarget[],
  boundary: HTMLElement | undefined
): { target: TourTarget; element: HTMLElement } | undefined {
  version();
  for (const target of targets) {
    // Several elements can share a target (every row of a list); point at
    // the top-most one on screen so the choice is stable and predictable.
    let best: { element: HTMLElement; rect: DOMRect } | undefined;
    for (const element of elements.get(target.id) ?? []) {
      if (!isShown(element)) continue;
      if (target.scope === 'view' && boundary && !boundary.contains(element))
        continue;
      const rect = element.getBoundingClientRect();
      if (
        !best ||
        rect.top < best.rect.top ||
        (rect.top === best.rect.top && rect.left < best.rect.left)
      )
        best = { element, rect };
    }
    if (best) return { target, element: best.element };
  }
  return undefined;
}
