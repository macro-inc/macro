import deepEqual from 'fast-deep-equal';
import { createEffect, createMemo, on } from 'solid-js';
import {
  createSearchParamsCodec,
  type SearchParamsCodecOptions,
  type SearchParamsRecord,
} from '../routes/search-params';
import type { SerializedSearchParams, WriteMode } from '../routes/types';
import { usePaneContext, useSplitRouter } from './context';
import { createMemoRecord } from './memo-record';

export type CreateSearchParamsOptions<T extends SearchParamsRecord> =
  SearchParamsCodecOptions<T> & { namespace: string };

type SetSearchParamsOptions = {
  mode?: 'merge' | 'replace';
  history?: WriteMode;
};

type SearchParamsPatch<T extends SearchParamsRecord> = {
  [Key in keyof T]?: T[Key] | undefined;
};

export type SetSearchParams<T extends SearchParamsRecord> = (
  next: SearchParamsPatch<T> | ((current: T) => SearchParamsPatch<T>),
  options?: SetSearchParamsOptions
) => void;

/** Typed access to one search namespace of the current pane. */
export function createSearchParams<T extends SearchParamsRecord>(
  options: CreateSearchParamsOptions<T>
): [T, SetSearchParams<T>] {
  const router = useSplitRouter();
  const scope = usePaneContext();
  const codec = createSearchParamsCodec(options);

  const namespaceParams = () => {
    const search = scope.entry()?.location.search;
    if (!search) return;
    if (!Object.hasOwn(search, options.namespace)) return;

    return search[options.namespace];
  };

  // Other namespaces, params and state change the entry too; only this namespace matters here.
  const raw = createMemo(namespaceParams, undefined, { equals: deepEqual });

  const parsed = createMemo(() => codec.parse(raw()));

  const writeSearch = (
    params: SerializedSearchParams | undefined,
    history: WriteMode | undefined
  ) =>
    router.updateSearch(scope.pane(), options.namespace, params, { history });

  const patched = (
    start: SearchParamsRecord,
    patch: SearchParamsPatch<T>
  ): SearchParamsRecord => {
    const candidate: SearchParamsRecord = { ...start };

    for (const [key, value] of Object.entries(patch)) {
      candidate[key] = value === undefined ? options.defaults[key] : value;
    }

    return candidate;
  };

  // The URL is an external system: invalid or non-canonical values are rewritten in place.
  createEffect(
    on([parsed, raw], ([current, rawParams]) => {
      const canonical = current.valid
        ? codec.serialize(current.value)
        : undefined;
      const alreadyCanonical = deepEqual(rawParams, canonical);
      if (alreadyCanonical) return;

      void writeSearch(canonical, 'replace');
    })
  );

  const setParams: SetSearchParams<T> = (next, setOptions = {}) => {
    const previous = parsed().value;
    const patch = typeof next === 'function' ? next(previous) : next;
    const replacing = setOptions.mode === 'replace';
    const start = replacing ? options.defaults : previous;
    const nextValue = codec.validate(patched(start, patch));

    if (!nextValue.success) {
      console.error(
        `Invalid search params for namespace "${options.namespace}"`,
        nextValue.error
      );
      return;
    }

    void writeSearch(codec.serialize(nextValue.data), setOptions.history);
  };

  return [createMemoRecord(() => parsed().value), setParams];
}
