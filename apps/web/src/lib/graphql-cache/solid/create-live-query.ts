import type { AnyVariables, DocumentInput } from '@urql/core';
import type { Accessor } from 'solid-js';
import { createUrqlQuery } from '../../urql-solid/create-urql-query';
import type { UrqlQueryOptions, UrqlQueryResult } from '../../urql-solid/types';

export type LiveQueryOptions<
  QueryData,
  Variables extends AnyVariables,
  Data = QueryData,
> = Partial<
  Omit<UrqlQueryOptions<QueryData, Variables, Data>, 'query' | 'variables'>
>;

/**
 * A document and reactive variables are the whole query declaration. The
 * client's normalized-cache exchange owns live projections and optimistic
 * updates. Undefined variables pause the query; the usual network policy
 * handles incomplete cache data and server-owned collection membership.
 */
export function createLiveQuery<
  QueryData,
  Variables extends AnyVariables,
  Data = QueryData,
>(
  document: DocumentInput<QueryData, Variables>,
  variables: Accessor<Variables | undefined>,
  options: Accessor<LiveQueryOptions<QueryData, Variables, Data>> = () => ({})
): UrqlQueryResult<Data, Variables, QueryData> {
  return createUrqlQuery(() => {
    const value = variables();
    const settings = options();
    if (value === undefined)
      return { ...settings, query: document, enabled: false };
    return {
      ...settings,
      query: document,
      variables: value,
    } as UrqlQueryOptions<QueryData, Variables, Data>;
  });
}
