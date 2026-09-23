import deepEqual from 'fast-deep-equal';
import { createEffect, createMemo, on } from 'solid-js';
import {
  createSearchParamsCodec,
  type SearchParamsCodecOptions,
  type SearchParamsRecord,
} from './search-params-codec';
import { useSplitRouterScope, useSplitRouterState } from './solid';
import type { BrowserHistoryIntent } from './types';
import { reactiveRecord } from './utils';

export type CreateSearchParamsOptions<T extends SearchParamsRecord> =
  SearchParamsCodecOptions<T> & { namespace: string };

export type SetSearchParamsOptions = {
  mode?: 'merge' | 'replace';
  history?: BrowserHistoryIntent;
};

export type SearchParamsPatch<T extends SearchParamsRecord> = {
  [Key in keyof T]?: T[Key] | undefined;
};

export type SetSearchParams<T extends SearchParamsRecord> = (
  next: SearchParamsPatch<T> | ((current: T) => SearchParamsPatch<T>),
  options?: SetSearchParamsOptions
) => void;

export function createSearchParams<T extends SearchParamsRecord>(
  options: CreateSearchParamsOptions<T>
): [T, SetSearchParams<T>] {
  const { router, search } = useSplitRouterState<unknown>();
  const splitId = useSplitRouterScope<unknown>();
  const codec = createSearchParamsCodec(options);
  const raw = () => search(splitId(), options.namespace);
  const parsed = createMemo(() => codec.parse(raw()));

  createEffect(
    on([parsed, raw], ([current, rawParams]) => {
      const canonical = current.valid
        ? codec.serialize(current.value)
        : undefined;
      if (deepEqual(rawParams, canonical)) return;
      router.updateSearch(splitId(), options.namespace, canonical, {
        history: 'replace',
      });
    })
  );

  const setParams: SetSearchParams<T> = (next, setOptions = {}) => {
    const previous = parsed().value;
    const patch = typeof next === 'function' ? next(previous) : next;
    const candidate: SearchParamsRecord = {
      ...(setOptions.mode === 'replace' ? options.defaults : previous),
    };
    for (const [key, value] of Object.entries(patch)) {
      candidate[key] = value === undefined ? options.defaults[key] : value;
    }
    const nextValue = codec.validate(candidate);
    if (!nextValue.success) {
      console.error(
        `Invalid search params for namespace "${options.namespace}"`,
        nextValue.error
      );
      return;
    }
    router.updateSearch(
      splitId(),
      options.namespace,
      codec.serialize(nextValue.data),
      { history: setOptions.history }
    );
  };

  return [reactiveRecord(() => parsed().value), setParams];
}
