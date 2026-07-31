import type { AnyVariables } from '@urql/core';
import type { Accessor } from 'solid-js';
import { createBaseQuery } from './create-base-query';
import { createInfiniteQueryObserver } from './infinite-query-observer';
import type {
  UrqlInfiniteData,
  UrqlInfiniteQueryOptions,
  UrqlInfiniteQueryResult,
} from './types';

/** Creates a live, paginated Solid binding over an urql infinite observer. */
export function createUrqlInfiniteQuery<
  PageData,
  Variables extends AnyVariables,
  PageParam,
  SelectedData = UrqlInfiniteData<PageData, PageParam>,
>(
  getOptions: Accessor<
    UrqlInfiniteQueryOptions<PageData, Variables, PageParam, SelectedData>
  >
): UrqlInfiniteQueryResult<PageData, Variables, PageParam, SelectedData> {
  return createBaseQuery(
    getOptions,
    createInfiniteQueryObserver<PageData, Variables, PageParam, SelectedData>,
    'createUrqlInfiniteQuery'
  );
}
