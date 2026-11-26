import type { SoupPage } from '@service-storage/generated/schemas';
import { SoupPreviewPageDocument } from '@service-storage/graphql/generated/graphql';
import {
  type FetchGraphqlSoupOptions,
  fetchGraphqlSoup,
} from '@service-storage/graphql-soup';
import type { SoupAstBody, SoupParams } from '../items';
import { makeGraphqlSoupInput } from './ast';
import {
  buildGraphqlEntitiesSoupInput,
  type SoupEntityRef,
} from './entity-input';

/**
 * Reads one page of a Soup list over GraphQL, for imperative callers (exports,
 * preview batches). Reactive lists use `useSoupAstItemsQuery`. Throws
 * `UnsupportedGraphqlSoupError` when the request has no GraphQL translation.
 * Rows come without their notifications, which these readers never show.
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
    SoupPreviewPageDocument,
    { input: makeGraphqlSoupInput(args) },
    options
  );
}

/**
 * Reads exactly `entities` over GraphQL. An entity missing from the page is
 * one the viewer cannot see.
 */
export async function fetchGraphqlSoupEntities(
  entities: readonly SoupEntityRef[],
  options: FetchGraphqlSoupOptions = {}
): Promise<SoupPage> {
  const input = buildGraphqlEntitiesSoupInput(entities);
  if (!input) return { items: [] };
  return await fetchGraphqlSoup(SoupPreviewPageDocument, { input }, options);
}
