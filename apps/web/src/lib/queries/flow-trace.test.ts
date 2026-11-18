import { QueryClient } from '@tanstack/solid-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { traceQueriesToFlows } from './flow-trace';

const { flow } = vi.hoisted(() => ({
  flow: { open: true, active: [] as string[] },
}));

vi.mock('@app/observability/flow', () => ({
  useFlowTrace: () =>
    flow.open
      ? {
          run<T>(work: () => T): T {
            flow.active.push('view.home');
            try {
              return work();
            } finally {
              flow.active.pop();
            }
          },
        }
      : undefined,
}));

describe('traceQueriesToFlows', () => {
  afterEach(() => {
    flow.open = true;
  });

  it('starts query functions in the flow that defaulted their options', async () => {
    const client = new QueryClient();
    traceQueriesToFlows(client);
    const startedIn: (string | undefined)[] = [];
    const queryFn = async () => {
      startedIn.push(flow.active.at(-1));
      return 1;
    };

    await client.fetchQuery({ queryKey: ['inside'], queryFn });
    flow.open = false;
    await client.fetchQuery({ queryKey: ['outside'], queryFn });

    expect(startedIn).toEqual(['view.home', undefined]);
  });
});
