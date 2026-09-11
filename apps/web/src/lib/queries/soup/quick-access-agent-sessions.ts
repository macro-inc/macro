import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableGraphqlSoup } from '@core/constant/featureFlags';
import type { AgentSessionEntity } from '@entity';
import { useQuery } from '@tanstack/solid-query';
import { agentSessionKeys } from '../agent-session/keys';
import { fetchRecentAgentSessionMentions } from '../agent-session/mention-fetchers';

/** Shared discovery feed; starts with Quick Access, before a mention menu opens. */
export function useQuickAccessAgentSessionsQuery() {
  const flag = useFeatureFlag(enableGraphqlSoup);
  const query = useQuery(() => ({
    queryKey: agentSessionKeys.recent(flag().enabled).queryKey,
    queryFn: () => fetchRecentAgentSessionMentions(flag().enabled),
    staleTime: 60_000,
  }));
  // Sessions are additive: a cold feed must not suspend the other entities.
  const sessions = (): AgentSessionEntity[] =>
    query.isSuccess
      ? query.data.map((session) => ({
          ...session,
          type: 'agent_session',
          status:
            session.status.kind === 'event'
              ? session.status.event
              : session.status.kind,
        }))
      : [];
  return { query, sessions };
}
