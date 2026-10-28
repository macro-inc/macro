import type { CrmCompanyEntity, EntityData } from '@entity';
import type { CrmWorkspace } from '../context/workspace-context';
export function createCrmExportLoader(
  source: CrmWorkspace['source'],
  loadAll: (
    signal: AbortSignal,
    progress: (count: number) => void
  ) => Promise<CrmCompanyEntity[]>,
  isCompany: (entity: EntityData) => entity is CrmCompanyEntity
) {
  return async (
    scope: 'current' | 'all',
    signal: AbortSignal,
    progress: (count: number) => void
  ) => {
    const wait = async () => {
      signal.throwIfAborted();
      await new Promise((resolve) => setTimeout(resolve, 100));
    };
    if (scope === 'all')
      return {
        companies: await loadAll(signal, progress),
      };
    while (source.isFetching()) await wait();
    if (source.error())
      throw new Error('Could not load this view. Please retry.');
    while (source.hasNextPage()) {
      signal.throwIfAborted();
      await source.fetchNextPage();
      await wait();
      if (source.error())
        throw new Error('Could not load the entire view. Please retry.');
      progress(source.data().length);
    }
    signal.throwIfAborted();
    let current = source.data().filter(isCompany);
    if (current.some((company) => !company.properties)) {
      const full = new Map(
        (await loadAll(signal, progress)).map((company) => [
          company.id,
          company,
        ])
      );
      current = current.map((company) => full.get(company.id) ?? company);
    }
    return { companies: current };
  };
}
