import { fireAndForget } from '@core/util/fireAndForget';
import {
  resolveBranch,
  type SplitRouteNode,
  type SplitRoutesManifest,
} from '../routes/manifest';
import { routeParams } from '../routes/queries';
import { replacePaneSearchParams } from '../routes/search';
import type {
  PreloadIntent,
  SplitLocation,
  SplitReference,
} from '../routes/types';
import { isPromise } from '../utils';

type PreloadContext = {
  location: SplitLocation;
  intent: PreloadIntent;
  signal: AbortSignal;
  reference?: SplitReference;
};

async function settleQuietly(work: Promise<unknown>): Promise<void> {
  try {
    await work;
  } catch {
    // The view's own Suspense and error boundaries report chunk failures.
  }
}

function hasPreload(component: unknown): component is { preload: unknown } {
  return typeof component === 'function' && 'preload' in component;
}

export async function preloadComponent(component: unknown): Promise<void> {
  if (!hasPreload(component)) return;

  const preload = component.preload;
  if (typeof preload !== 'function') return;

  const chunk: unknown = preload.call(component);
  if (chunk instanceof Promise) await chunk;
}

function preloadNode(
  node: SplitRouteNode,
  depth: number,
  context: PreloadContext
): Promise<unknown> | undefined {
  const { definition } = node;
  const { location, intent, signal } = context;
  fireAndForget(
    settleQuietly(preloadComponent(definition.component)),
    'split-router'
  );

  const data = definition.preload?.({
    location,
    reference: context.reference,
    params: routeParams(location.route, depth + 1),
    search: location.search,
    intent,
    signal,
  });

  return isPromise(data) ? data : undefined;
}

/** Canonical route-owned entity reference, including scoped target search. */
export function referenceForLocation(
  routes: SplitRoutesManifest,
  location: SplitLocation
): SplitReference | undefined {
  const leaf = resolveBranch(routes, location.route).at(-1);
  const query = new URLSearchParams();
  replacePaneSearchParams(query, [location.search]);
  let reference: SplitReference | undefined;
  try {
    reference = leaf?.definition.toReference?.(
      routeParams(location.route),
      query
    );
  } catch {
    // A malformed speculative destination must never fail navigation.
  }
  return reference;
}

/**
 * Starts loading every `lazy()` chunk along the branch without waiting for
 * them, and returns only the route data preloads that need waiting for.
 * A preload that fails, synchronously or not, never fails the navigation.
 */
export function preloadLocation(
  routes: SplitRoutesManifest,
  context: PreloadContext
): Promise<unknown> | undefined {
  const work: Promise<unknown>[] = [];
  const branch = resolveBranch(routes, context.location.route);

  const reference = referenceForLocation(routes, context.location);

  branch.forEach((node, depth) => {
    try {
      const data = preloadNode(node, depth, { ...context, reference });
      if (data) work.push(data);
    } catch (error) {
      console.error(
        `Split route "${node.definition.id}" preload failed`,
        error
      );
    }
  });

  if (work.length === 0) return;

  return Promise.allSettled(work);
}

export async function withinBudget(
  work: Promise<unknown>,
  ms: number
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });

  try {
    await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
