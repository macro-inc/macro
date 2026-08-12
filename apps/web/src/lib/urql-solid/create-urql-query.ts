import type { AnyVariables } from '@urql/core';
import type { Accessor } from 'solid-js';
import { createBaseQuery } from './create-base-query';
import { createQueryObserver } from './query-observer';
import type { UrqlQueryOptions, UrqlQueryResult } from './types';

/** Creates a live Solid binding over one urql query observer. */
export function createUrqlQuery<
  QueryData = unknown,
  Variables extends AnyVariables = AnyVariables,
  Data = QueryData,
>(
  getOptions: Accessor<UrqlQueryOptions<QueryData, Variables, Data>>
): UrqlQueryResult<Data, Variables, QueryData> {
  return createBaseQuery(
    getOptions,
    createQueryObserver<QueryData, Variables, Data>,
    'createUrqlQuery'
  );
}
