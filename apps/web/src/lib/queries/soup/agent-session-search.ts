import { mergeAdjacentMacroEmTags } from '@core/util/searchHighlight';
import type { AgentSessionEntity } from '@entity/types/entity';
import type { WithSearch } from '@entity/types/search';
import type { AgentSessionSearchResponseItem } from '@service-search/generated/models';

/** Search is a projection of the server-folded transcript, not raw ACP logs. */
export function mapAgentSessionSearchResult(
  result: AgentSessionSearchResponseItem
): WithSearch<AgentSessionEntity> {
  const matches = result.agent_session_search_results;
  const nameHighlight = matches.find((hit) => hit.highlight.name)?.highlight
    .name;
  const contentHitData = matches.flatMap((hit) => {
    const target = hit.goto;
    if (!target) return [];
    return (hit.highlight.content ?? []).map((content) => ({
      type: 'agent' as const,
      content: mergeAdjacentMacroEmTags(content),
      location: {
        type: 'agent' as const,
        messageTurn: target.message_turn,
        author: target.author,
      },
    }));
  });
  return {
    type: 'agent_session',
    id: result.id,
    name: result.name,
    ownerId: result.owner_id,
    botId: result.bot_id,
    // Search only returns sessions that were materialized from a folded event.
    status: 'event',
    createdAt: result.created_at,
    updatedAt: result.updated_at,
    search: {
      nameHighlight: nameHighlight
        ? mergeAdjacentMacroEmTags(nameHighlight)
        : null,
      contentHitData: contentHitData.length ? contentHitData : null,
      senderHighlightTerms: null,
      source: 'service',
    },
  };
}
