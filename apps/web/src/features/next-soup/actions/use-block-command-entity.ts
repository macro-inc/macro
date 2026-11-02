import { QUERY_FILTERS_BASE } from '@app/features/next-soup/filters/query-filters';
import { useIsAuthenticated } from '@core/context/user';
import type { EntityData } from '@entity';
import { useSoupItemsQuery } from '@queries/soup/items';
import type { Accessor } from 'solid-js';

/** Resolve a block's commands without loading the account-wide search index. */
export function useBlockCommandEntity(
  id: string,
  supplied: Accessor<EntityData | undefined>
): Accessor<EntityData | undefined> {
  const authenticated = useIsAuthenticated();
  const query = useSoupItemsQuery(
    () => ({
      params: { limit: 1 },
      body: {
        ...QUERY_FILTERS_BASE,
        document_filters: { document_ids: [id] },
        channel_filters: { channel_ids: [id] },
        chat_filters: { chat_ids: [id] },
        project_filters: { project_ids: [id] },
      },
    }),
    () => ({
      enabled: authenticated() === true && !supplied(),
      staleTime: 60_000,
    })
  );
  // Conditions run during command-menu evaluation: never read pending query data.
  return () =>
    supplied() ??
    (query.isSuccess
      ? query.data.find((entity) => entity.id === id)
      : undefined);
}
