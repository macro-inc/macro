import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableAgentTeammates } from '@core/constant/featureFlags';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { useTeamAgentsQuery } from '@queries/team-agents/team-agents';
import type { TeamAgent } from '@service-auth/team-agents';
import { type Accessor, createMemo } from 'solid-js';

export type DriveAgentsInfo = {
  myAgents: Accessor<TeamAgent[]>;
  teamAgents: Accessor<TeamAgent[]>;
  myAgentIds: Accessor<string[]>;
  teamAgentIds: Accessor<string[]>;
  hasTeamAgents: Accessor<boolean>;
};

/**
 * Exposes the viewer's own agent teammates (`createdBy === userId`) and all
 * team agent teammates for Drive's "Created by me / my agents" filter presets.
 */
export function useDriveAgents(
  userId: Accessor<string | undefined>
): DriveAgentsInfo {
  const flag = useFeatureFlag(enableAgentTeammates);
  const enabled = () => Boolean(userId()) && !flag().loading && flag().enabled;
  const team = useCurrentTeamQuery(enabled);
  const agentsQuery = useTeamAgentsQuery(
    () => (team.isSuccess ? (team.data?.team.id ?? '') : ''),
    enabled
  );

  const teamAgents = createMemo<TeamAgent[]>(() => {
    if (!enabled() || !agentsQuery.isSuccess) return [];
    return agentsQuery.data.agents.filter(
      (agent) => agent.status !== 'released'
    );
  });

  const myAgents = createMemo<TeamAgent[]>(() => {
    const viewer = userId();
    if (!viewer) return [];
    return teamAgents().filter((agent) => agent.createdBy === viewer);
  });

  const myAgentIds = createMemo(() => myAgents().map((agent) => agent.userId));
  const teamAgentIds = createMemo(() =>
    teamAgents().map((agent) => agent.userId)
  );

  return {
    myAgents,
    teamAgents,
    myAgentIds,
    teamAgentIds,
    hasTeamAgents: () => teamAgents().length > 0,
  };
}
