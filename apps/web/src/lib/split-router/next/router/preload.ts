import {
  resolveBranch,
  type SplitRouteNode,
  type SplitRoutesManifest,
} from '../routes/manifest';
import { mergedParams } from '../routes/queries';
import type { PreloadIntent, SplitLocation } from '../routes/types';
import { isPromise } from '../utils';

type PreloadContext = {
  location: SplitLocation;
  intent: PreloadIntent;
  signal: AbortSignal;
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

function warmComponent(component: unknown): void {
  if (!hasPreload(component)) return;

  const preload = component.preload;
  if (typeof preload !== 'function') return;

  const chunk: unknown = preload.call(component);
  if (chunk instanceof Promise) void settleQuietly(chunk);
}

function preloadNode(
  node: SplitRouteNode,
  depth: number,
  context: PreloadContext
): Promise<unknown> | undefined {
  const { definition } = node;
  const { location, intent, signal } = context;
  warmComponent(definition.component);

  const data = definition.preload?.({
    params: mergedParams(location.route, depth + 1),
    search: location.search,
    intent,
    signal,
  });

  return isPromise(data) ? data : undefined;
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

  branch.forEach((node, depth) => {
    try {
      const data = preloadNode(node, depth, context);
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
