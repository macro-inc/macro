import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { type CrmCompanyEntity, isCrmCompanyEntity } from '@entity';
import { fetchGraphqlSoupPage } from '@queries/soup/graphql/fetch-page';
import type { SoupAstItemsQueryArgs } from '@queries/soup/items';
import { mapApiSoupItemToEntity } from '../../../lib/queries/soup/transform-utils';

/** Every visible company, in pages of 500. */
export const CRM_EXPORT_COMPANIES_ARGS: SoupAstItemsQueryArgs = {
  params: { limit: 500, sort_method: 'updated_at' },
  body: compileToAst(
    queryStateFrom(
      defineQueryFilters(
        { include: { crmCompanyHidden: false } },
        { skipTargets: ['ccf'] }
      )
    )
  ),
};

/** Read every visible company, without changing the active CRM view. */
export async function fetchCrmExportCompanies(
  signal: AbortSignal,
  onProgress: (count: number) => void
) {
  const companies = new Map<string, CrmCompanyEntity>();
  let cursor: string | null = null;
  const cursors = new Set<string>();
  do {
    signal.throwIfAborted();
    const page = await fetchGraphqlSoupPage(
      { ...CRM_EXPORT_COMPANIES_ARGS, cursor },
      // An export reads the server's list, never a cached or offline copy.
      { signal, requestPolicy: 'network-only', allowOfflineFallback: false }
    );
    signal.throwIfAborted();
    for (const item of page.items) {
      const entity = mapApiSoupItemToEntity(item);
      if (isCrmCompanyEntity(entity)) companies.set(entity.id, entity);
    }
    onProgress(companies.size);
    cursor = page.next_cursor ?? null;
    if (cursor && cursors.has(cursor))
      throw new Error('Export pagination did not advance. Please retry.');
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return [...companies.values()];
}
