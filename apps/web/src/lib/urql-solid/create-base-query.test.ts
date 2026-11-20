import type { Client } from '@urql/core';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createBaseQuery } from './create-base-query';
import type { ObserverClientOptions } from './observer';
import { TRACE_PARENT_CONTEXT_KEY } from './trace-parent-exchange';

const viewFlow = vi.hoisted(() => ({ run: <T>(work: () => T) => work() }));
vi.mock('@app/observability/flow', () => ({ useFlowTrace: () => viewFlow }));

describe('createBaseQuery', () => {
  it('keeps the observer snapshot separate from the mutable result store', () => {
    createRoot((dispose) => {
      try {
        const initial = {
          data: undefined as string | undefined,
          fetching: true,
        };
        let notify: ((result: typeof initial) => void) | undefined;
        const query = createBaseQuery(
          () => ({ client: {} as Client }),
          () => ({
            getCurrentResult: () => initial,
            setOptions: () => {},
            subscribe: (listener) => {
              notify = listener;
              return () => {};
            },
            destroy: () => {},
          }),
          'testQuery'
        );

        notify?.({ data: 'loaded', fetching: false });
        expect(query.data).toBe('loaded');
        expect(initial).toEqual({ data: undefined, fetching: true });

        notify?.(initial);
        expect(query.data).toBeUndefined();
        expect(query.fetching).toBe(true);
      } finally {
        dispose();
      }
    });
  });

  it("sends requests in the loading view's trace unless the query names its own", () => {
    const own = { run: <T>(work: () => T) => work() };
    const parentOf = (context?: Record<string, unknown>) =>
      createRoot((dispose) => {
        let sent: ObserverClientOptions | undefined;
        createBaseQuery(
          () => ({ client: {} as Client, context }),
          (_client, options) => {
            sent = options;
            return {
              getCurrentResult: () => ({}),
              setOptions: () => {},
              subscribe: () => () => {},
              destroy: () => {},
            };
          },
          'testQuery'
        );
        dispose();
        return sent?.context?.[TRACE_PARENT_CONTEXT_KEY];
      });

    expect(parentOf()).toBe(viewFlow);
    expect(parentOf({ [TRACE_PARENT_CONTEXT_KEY]: own })).toBe(own);
  });
});
