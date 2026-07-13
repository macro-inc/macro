import type { Client, OperationResult } from '@urql/core';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { makeSubject } from 'wonka';
import { createQuerySignal, type QuerySignal } from './create-query-signal';

type FakeResult = Partial<OperationResult>;

/**
 * Fake urql client: each `query()` call returns a fresh subject the test
 * pushes results into, mimicking the long-lived sources the normalized
 * cache exchange re-emits on.
 */
function makeFakeClient() {
  const executions: Array<{
    variables: unknown;
    next: (result: FakeResult) => void;
  }> = [];
  const client = {
    query: (_document: unknown, variables: unknown) => {
      const subject = makeSubject<FakeResult>();
      executions.push({ variables, next: subject.next });
      return subject.source;
    },
  } as unknown as Client;
  return { client, executions };
}

const DOCUMENT = {} as never;

type Variables = { cursor: string | null };

// Note: signal writes and result pushes must happen OUTSIDE the createRoot
// body — solid batches the body, deferring effect re-runs until it returns.
function setup() {
  const { client, executions } = makeFakeClient();
  let query!: QuerySignal<unknown>;
  let setVariables!: (v: Variables | undefined) => void;
  const dispose = createRoot((dispose) => {
    const [variables, setVars] = createSignal<Variables | undefined>({
      cursor: null,
    });
    setVariables = setVars;
    query = createQuerySignal({
      client: () => client,
      document: DOCUMENT,
      variables,
    });
    return dispose;
  });
  return { executions, query, setVariables, dispose };
}

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
});

describe('createQuerySignal', () => {
  it('tracks results pushed over the operation lifetime', () => {
    const harness = setup();
    dispose = harness.dispose;
    const { query, executions } = harness;

    expect(query.fetching()).toBe(true);
    expect(query.data()).toBeUndefined();
    expect(executions).toHaveLength(1);

    // Stale cache hit first…
    executions[0]?.next({ data: { from: 'cache' }, stale: true });
    expect(query.data()).toEqual({ from: 'cache' });
    expect(query.stale()).toBe(true);
    expect(query.fetching()).toBe(false);

    // …then the network result, then a cache-pushed re-execution.
    executions[0]?.next({ data: { from: 'network' }, stale: false });
    expect(query.data()).toEqual({ from: 'network' });
    executions[0]?.next({ data: { from: 'optimistic' }, stale: false });
    expect(query.data()).toEqual({ from: 'optimistic' });
  });

  it('resubscribes when variables change and ignores the old source', () => {
    const harness = setup();
    dispose = harness.dispose;
    const { query, executions, setVariables } = harness;

    executions[0]?.next({ data: { page: 1 } });
    expect(query.data()).toEqual({ page: 1 });

    setVariables({ cursor: 'next' });
    expect(query.fetching()).toBe(true);
    expect(executions).toHaveLength(2);
    expect(executions[1]?.variables).toEqual({ cursor: 'next' });

    // The unsubscribed first execution must not clobber the signal.
    executions[0]?.next({ data: { page: 'stale-old' } });
    expect(query.data()).toEqual({ page: 1 });
    executions[1]?.next({ data: { page: 2 } });
    expect(query.data()).toEqual({ page: 2 });
  });

  it('pauses on undefined variables, keeping the last data', () => {
    const harness = setup();
    dispose = harness.dispose;
    const { query, executions, setVariables } = harness;

    executions[0]?.next({ data: { page: 1 } });
    setVariables(undefined);
    expect(query.fetching()).toBe(false);
    expect(query.data()).toEqual({ page: 1 });
    expect(executions).toHaveLength(1);

    // Old subscription is torn down: late results are ignored.
    executions[0]?.next({ data: { page: 'late' } });
    expect(query.data()).toEqual({ page: 1 });
  });
});
