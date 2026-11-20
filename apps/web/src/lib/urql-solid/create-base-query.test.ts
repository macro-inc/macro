import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import type { Client } from '@urql/core';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createBaseQuery } from './create-base-query';

describe('createBaseQuery', () => {
  it('keeps the observer on an options change after a same-access baseline correction', () => {
    createRoot((dispose) => {
      try {
        const client = {} as Client;
        const [variable, setVariable] = createSignal('before');
        const destroy = vi.fn();
        const setOptions = vi.fn();
        const factory = vi.fn(() => ({
          getCurrentResult: () => ({ data: 'kept' }),
          setOptions,
          subscribe: () => () => {},
          destroy,
        }));
        const query = createBaseQuery(
          () => ({ client, variable: variable() }),
          factory,
          'testQuery'
        );
        cacheSessionGeneration.initialize('corrected-owner-generation');
        setVariable('after');
        expect(query.data).toBe('kept');
        expect(factory).toHaveBeenCalledOnce();
        expect(destroy).not.toHaveBeenCalled();
        expect(setOptions).toHaveBeenCalledOnce();
      } finally {
        dispose();
      }
    });
  });

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
