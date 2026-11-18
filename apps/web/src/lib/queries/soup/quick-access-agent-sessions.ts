import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import type { AgentSessionEntity } from '@entity';
import { useBotsQuery } from '../bots/bots';
import { firstPartyBotName } from '../bots/first-party-bot-name';
import { queryReadyGate } from '../gate';
import {
  QUICK_ACCESS_FEED_OPTIONS,
  type SoupAstItemsQueryArgs,
  useSoupAstItemsQuery,
} from './items';

/** Agent sessions only, most recently updated first. */
export const QUICK_ACCESS_AGENT_SESSIONS_ARGS: SoupAstItemsQueryArgs = {
  params: { limit: 500, sort_method: 'updated_at' },
  body: compileToAst(
    queryStateFrom(
      defineQueryFilters({ include: { includeAgentSessions: true } })
    )
  ),
};

/** Shared discovery feed; starts with Quick Access, before a mention menu opens. */
export function useQuickAccessAgentSessionsQuery() {
  const query = useSoupAstItemsQuery(
    () => QUICK_ACCESS_AGENT_SESSIONS_ARGS,
    () => QUICK_ACCESS_FEED_OPTIONS
  );
  const botsQuery = useBotsQuery();
  // Optional persona enrichment never holds up the session list or other entities.
  const sessions = (): AgentSessionEntity[] => {
    if (!queryReadyGate(query)) return [];
    const bots = new Map(
      (botsQuery.isSuccess ? botsQuery.data : []).map((bot) => [bot.id, bot])
    );
    return query.data.entities
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
