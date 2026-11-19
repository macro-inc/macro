import { beginInteraction } from '@app/observability/flow';
import type { Span, TraceContext } from '@macro-inc/observability';
import type { RefetchOptions } from '@tanstack/solid-query';

export async function traceRoutineRequest<T>(
  span: Span,
  request: () => Promise<T>
) {
  try {
    return await span.run(request);
  } catch (error) {
    span.error('Routine request failed');
    throw error;
  } finally {
    span.end();
  }
}

export async function traceRoutineInteraction<T>(
  name: string,
  scheduleId: string,
  request: (span: Span, markFailed: () => void) => Promise<T>
): Promise<T> {
  const interaction = beginInteraction(`${name}.action`, {
    attributes: { 'routine.id': scheduleId },
  });
  const release = interaction.hold();
  let failed = false;
  const start = () => {
    try {
      const span = interaction.span.span(name);
      span.setAttr('routine.id', scheduleId);
      return traceRoutineRequest(span, () =>
        request(span, () => {
          failed = true;
        })
      );
    } finally {
      // Close the join window so the next click starts its own flow.
      interaction.end();
    }
  };
  try {
    return await start();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    release(failed ? 'error' : 'success');
  }
}

// TanStack forwards fetch metadata through refetch and invalidation to its
// per-fetch behavior. The token has no routine ID and holds no span in cache.
const refreshParents = new WeakMap<object, TraceContext>();

export async function withRoutineQueryTrace<T>(
  parent: TraceContext | undefined,
  refresh: (options?: RefetchOptions) => Promise<T>
): Promise<T> {
  if (!parent) return refresh();
  const meta = {};
  const options = { meta, cancelRefetch: true };
  refreshParents.set(meta, parent);
  try {
    return await refresh(options);
  } finally {
    refreshParents.delete(meta);
  }
}

export const routineQueryTrace = {
  onFetch(context: {
    fetchOptions?: { meta?: object };
    fetchFn: () => unknown;
  }) {
    const meta = context.fetchOptions?.meta;
    if (!meta || !refreshParents.has(meta)) return;
    const fetch = context.fetchFn;
    context.fetchFn = () => {
      const parent = refreshParents.get(meta);
      return parent ? parent.run(fetch) : fetch();
    };
  },
};
