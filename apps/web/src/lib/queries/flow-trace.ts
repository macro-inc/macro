import { useFlowTrace } from '@app/observability/flow';
import type { QueryClient } from '@tanstack/solid-query';

/**
 * Runs each query function in the trace of the view that created the query,
 * so its requests join that view's load (see `Flow.run`). Observers default
 * their options during component setup, where the flow is in scope; options
 * defaulted elsewhere, and refetches after the view settled, are untouched.
 */
export function traceQueriesToFlows(client: QueryClient): void {
  const defaultQueryOptions = client.defaultQueryOptions.bind(client);
  client.defaultQueryOptions = ((options) => {
    const defaulted = defaultQueryOptions(options);
    if (options._defaulted) return defaulted;
    const parent = useFlowTrace();
    const queryFn = defaulted.queryFn;
    if (!parent || typeof queryFn !== 'function') return defaulted;
    return {
      ...defaulted,
      queryFn: (context) => parent.run(() => queryFn(context)),
    };
  }) as QueryClient['defaultQueryOptions'];
}
