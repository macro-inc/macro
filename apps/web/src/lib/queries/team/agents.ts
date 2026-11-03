import { throwOnErr } from '@core/util/result';
import { authServiceClient } from '@service-auth/client';
import type { CreateTeamAgent } from '@service-auth/generated/schemas/createTeamAgent';
import type { TeamAgent } from '@service-auth/generated/schemas/teamAgent';
import { useMutation } from '@tanstack/solid-query';
import { invalidateTeam } from './teams';

type CreateTeamAgentArgs = { teamId: string; request: CreateTeamAgent };

/**
 * Creates a team agent: its account joins the team and its brain starts on
 * the chosen runtime in the background.
 */
export function useCreateTeamAgentMutation() {
  return useMutation(() => ({
    mutationFn: async ({ request }: CreateTeamAgentArgs): Promise<TeamAgent> =>
      await throwOnErr(() => authServiceClient.createTeamAgent(request)),
    onSuccess: async (_agent: TeamAgent, { teamId }: CreateTeamAgentArgs) =>
      await invalidateTeam(teamId),
  }));
}
