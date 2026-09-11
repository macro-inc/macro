import type { AgentSessionFilters } from '@service-search/generated/models';
import { NIL_UUID } from '../filters/filter-store';
import type { FieldFilters } from '../filters/filter-store/types';

/** The Agents facet includes both conversation systems, with distinct IDs.
 * NIL-filled chat IDs exclude the facet; explicit legacy IDs and project
 * membership must not accidentally admit unrelated ACP sessions either. */
export function agentSessionSearchFilters(
  include: Pick<FieldFilters, 'chatId' | 'chatOwnerId' | 'chatProjectId'>
): AgentSessionFilters {
  return {
    include: !include.chatId?.length && !include.chatProjectId?.length,
    ids:
      include.chatId?.length || include.chatProjectId?.length
        ? [NIL_UUID]
        : undefined,
    owners: include.chatOwnerId,
  };
}
