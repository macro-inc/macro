import type { useSoupAstItemsQuery } from '@queries/soup/items';
import { type Accessor, createMemo } from 'solid-js';
import type { CrmActivityTab } from '../core/navigation';
import { crmActivityBody } from './activity-filter';

/** A bounded query for the complete authorized CRM activity feed. */
export function useCrmActivityQuery(
  createQuery: typeof useSoupAstItemsQuery,
  tab: Accessor<CrmActivityTab>,
  userId: Accessor<string | undefined>
) {
  const body = createMemo(() => crmActivityBody(tab()));
  return createQuery(
    () => ({
      params: { limit: 100, sort_method: 'updated_at' },
      body: body(),
    }),
    () => ({ enabled: !!userId() })
  );
}
