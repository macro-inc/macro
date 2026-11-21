import { clause, compileClause, confine } from '@app/features/soup/filters';
import {
  type SoupAstItemsQueryArgs,
  useSoupAstItemsQuery,
} from '@queries/soup/items';
import type { Accessor } from 'solid-js';
import { conversationCodeDetails } from './conversation-code-details';

/** The existing Soup API hydrates one authorized session, never an owner history. */
export function sessionCodeQuery(
  id: string,
  ownerId: string
): SoupAstItemsQueryArgs {
  return {
    params: { expand: true, sort_method: 'updated_at', limit: 1 },
    body: compileClause(
      confine({
        asf: clause.and(
          clause.eq('includeAgentSessions', true),
          clause.eq('agentSessionId', id),
          clause.eq('agentSessionOwnerId', ownerId)
        ),
      })
    ),
  };
}

/** A direct link needs code identity even before a conversation list was loaded. */
export function createSessionCodeDetailsSource(
  id: Accessor<string | undefined>,
  ownerId: Accessor<string | undefined>
) {
  const query = useSoupAstItemsQuery(
    () => sessionCodeQuery(id() ?? '', ownerId() ?? ''),
    () => ({ enabled: Boolean(id() && ownerId()), keepPreviousData: false })
  );
  return () => {
    if (!id() || !ownerId() || query.isPending) return undefined;
    const entity = query.data?.entities.find((item) => item.id === id());
    return entity?.type === 'agent_session'
      ? conversationCodeDetails(entity)
      : undefined;
  };
}
