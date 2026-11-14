import type { Client } from '@urql/core';
import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { beginQueryAuthorizationReset } from './authorization';
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

it('replaces live snapshots during permission retirement without reusing retained data', () => {
  createRoot((dispose) => {
    try {
      const client = {} as Client;
      let created = 0;
      let destroyed = 0;
      const query = createBaseQuery<
        { client: Client; enabled: boolean },
        { data: string | undefined; enabled: boolean }
      >(
        () => ({ client, enabled: true }),
        (_client, options) => {
          created += 1;
          let snapshot = {
            data: options.enabled ? 'old record' : undefined,
            enabled: options.enabled,
          };
          let notify: ((value: typeof snapshot) => void) | undefined;
          return {
            getCurrentResult: () => snapshot,
            setOptions: (next) => {
              snapshot = { data: undefined, enabled: next.enabled };
              notify?.(snapshot);
            },
            subscribe: (listener) => {
              notify = listener;
              return () => {
                notify = undefined;
              };
            },
            destroy: () => {
              destroyed += 1;
            },
          };
        },
        'permission-test'
      );
      expect(query.data).toBe('old record');
      const resume = beginQueryAuthorizationReset();
      expect(query.data).toBeUndefined();
      expect(query.enabled).toBe(false);
      expect(created).toBe(2);
      expect(destroyed).toBe(1);
      resume();
      expect(query.data).toBeUndefined();
      expect(query.enabled).toBe(true);
    } finally {
      dispose();
    }
  });
});
