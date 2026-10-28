import { QUERY_FILTERS_BASE } from '@app/features/next-soup/filters/query-filters';
import type { AgentSessionEntity } from '@entity';
import { useBotsQuery } from '../bots/bots';
import { firstPartyBotName } from '../bots/first-party-bot-name';
import { useSoupItemsQuery } from './items';

/** Shared discovery feed; starts with Quick Access, before a mention menu opens. */
export function useQuickAccessAgentSessionsQuery() {
  const query = useSoupItemsQuery(
    () => ({
      params: { limit: 500, sort_method: 'updated_at' },
      body: {
        ...QUERY_FILTERS_BASE,
        agent_session_filters: { include: true },
      },
    }),
    () => ({ staleTime: 60_000 })
  );
  const botsQuery = useBotsQuery();
  // Optional persona enrichment never holds up the session list or other entities.
  const sessions = (): AgentSessionEntity[] => {
    if (!query.isSuccess) return [];
    const bots = new Map(
      (botsQuery.isSuccess ? botsQuery.data : []).map((bot) => [bot.id, bot])
    );
    return query.data
      .filter((entity) => entity.type === 'agent_session')
      .map((session) => {
        if (session.bot?.name) return session;
        const bot = bots.get(session.botId);
        const name = firstPartyBotName(session.botId) ?? bot?.name;
        return name
          ? {
              ...session,
              bot: { id: session.botId, name, avatarUrl: bot?.avatar_url },
            }
          : session;
      });
  };
  return { query, sessions };
}
