import { QUERY_FILTERS_BASE } from '@app/features/next-soup/filters/query-filters';
import type { AgentSessionEntity } from '@entity';
import { firstPartyBotName } from '../bots/first-party-bot-name';
import { createBotIdentities } from '../bots/graphql-bots';
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
  const agentSessions = (): AgentSessionEntity[] =>
    query.isSuccess
      ? query.data.filter((entity) => entity.type === 'agent_session')
      : [];
  // Optional persona enrichment never holds up the session list or other
  // entities: a session shows its bot as it is now once that is read.
  const identity = createBotIdentities(() =>
    agentSessions()
      .map((session) => session.botId)
      .filter((botId) => !firstPartyBotName(botId))
  );
  const sessions = (): AgentSessionEntity[] =>
    agentSessions().map((session) => {
      const systemName = firstPartyBotName(session.botId);
      const bot = systemName ? undefined : identity(session.botId);
      if (bot) {
        return {
          ...session,
          bot: { id: bot.id, name: bot.name, avatarUrl: bot.avatarUrl },
        };
      }
      if (session.bot?.name || !systemName) return session;
      return { ...session, bot: { id: session.botId, name: systemName } };
    });
  return { query, sessions };
}
