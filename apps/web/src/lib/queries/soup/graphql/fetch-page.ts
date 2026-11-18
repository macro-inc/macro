import type { SoupPage } from '@service-storage/generated/schemas';
import { SoupDocument } from '@service-storage/graphql/generated/graphql';
import {
  type FetchGraphqlSoupOptions,
  fetchGraphqlSoup,
} from '@service-storage/graphql-soup';
import type { SoupAstBody, SoupParams } from '../items';
import { makeGraphqlSoupInput } from './ast';

/**
 * Reads one page of a Soup list over GraphQL, for imperative callers (exports,
 * preview batches). Reactive lists use `useSoupAstItemsQuery`. Throws
 * `UnsupportedGraphqlSoupError` when the request has no GraphQL translation.
 */
export async function fetchGraphqlSoupPage(
  args: {
    params: SoupParams;
    body: SoupAstBody;
    cursor?: string | null;
  },
  options: FetchGraphqlSoupOptions = {}
): Promise<SoupPage> {
  return await fetchGraphqlSoup(
    SoupDocument,
    { input: makeGraphqlSoupInput(args) },
    options
  );
}
