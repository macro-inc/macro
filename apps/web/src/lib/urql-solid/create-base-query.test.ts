import type { Client } from '@urql/core';
import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createBaseQuery } from './create-base-query';

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
});
