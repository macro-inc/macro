import { QUERY_FILTERS_BASE } from '@app/features/next-soup/filters/query-filters';
import { throwOnErr } from '@core/util/result';
import { type CrmCompanyEntity, isCrmCompanyEntity } from '@entity';
import { storageServiceClient } from '@service-storage/client';
import { mapApiSoupItemToEntity } from '../soup/transform-utils';

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
    const page = await throwOnErr(() =>
      storageServiceClient.getSoupItems({
        params: { cursor },
        body: {
          ...QUERY_FILTERS_BASE,
          crm_company_filters: { hidden: false },
          limit: 500,
          sort_method: 'updated_at',
        },
      })
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
