import { toast } from '@core/component/Toast/Toast';
import type { IUser } from '@core/user';
import { idToDisplayName, idToEmail } from '@core/user/util';
import { fireAndForget } from '@core/util/fireAndForget';
import { throwOnErr } from '@core/util/result';
import type { PaidPlan } from '@service-auth/ai-billing-types';
import { authServiceClient } from '@service-auth/client';
import type { TeamWithMembers } from '@service-auth/generated/schemas/teamWithMembers';
import { useMutation } from '@tanstack/solid-query';
import { type Accessor, createMemo } from 'solid-js';
import {
  invalidateAiBillingSummary,
  invalidateSubscriptionStatus,
} from '../auth';
import { queryClient } from '../client';
import { queryReadyGate } from '../gate';
import { type MutationCallbacks, withCallbacks } from '../utils';
import { teamKeys } from './keys';
import { invalidateTeam, useCurrentTeamQuery } from './teams';

type RemoveUserFromTeamArgs = { teamId: string; userId: string };
type RemoveUserFromTeamContext = { previousTeam: TeamWithMembers | undefined };
type RemoveUserFromTeamCallbacks = MutationCallbacks<
  void,
  Error,
  RemoveUserFromTeamArgs,
  RemoveUserFromTeamContext
>;

/** The cached current team roster, independent of the viewer's contacts. */
export function useTeamMembers(enabled: Accessor<boolean>) {
  const query = useCurrentTeamQuery(enabled);
  const users = createMemo((): IUser[] => {
    if (!enabled()) return [];
    if (!queryReadyGate(query)) return [];

    return (query.data?.members ?? []).map(({ user_id }) => ({
      id: user_id,
      email: idToEmail(user_id),
      name: idToDisplayName(user_id),
    }));
  });

  return {
    users,
    isLoading: () => enabled() && query.isPending,
    isError: () => enabled() && query.isError,
  };
}

export function useRemoveUserFromTeamMutation(
  callbacks?: RemoveUserFromTeamCallbacks
) {
  return useMutation(() => ({
    mutationFn: async ({ userId }: RemoveUserFromTeamArgs) => {
      await throwOnErr(() => authServiceClient.removeUserFromTeam(userId));
    },

    ...withCallbacks<
      void,
      Error,
      RemoveUserFromTeamArgs,
      RemoveUserFromTeamContext
    >(
      {
        onMutate: async ({ teamId, userId }) => {
          const queryKey = teamKeys.detail(teamId).queryKey;
          await queryClient.cancelQueries({ queryKey });

          const previousTeam =
            queryClient.getQueryData<TeamWithMembers>(queryKey);

          queryClient.setQueryData<TeamWithMembers>(queryKey, (old) =>
            old
              ? {
                  ...old,
                  members: old.members.filter(
                    (member) => member.user_id !== userId
                  ),
                }
              : undefined
          );

          return { previousTeam };
        },

        onSuccess: (_data, { teamId }) => {
          fireAndForget(invalidateTeam(teamId), 'team-settings');
          toast.success('Member removed');
        },

        onError: (error, { teamId }, context) => {
          console.error('Failed to remove user from team', error);
          toast.failure('Failed to remove team member');

          if (context?.previousTeam) {
            queryClient.setQueryData(
              teamKeys.detail(teamId).queryKey,
              context.previousTeam
            );
          }
        },
      },
      callbacks
    ),
  }));
}

type SetTeamMemberPlanArgs = { teamId: string; userId: string; plan: PaidPlan };
type SetTeamMemberPlanCallbacks = MutationCallbacks<
  void,
  Error,
  SetTeamMemberPlanArgs
>;

/**
 * Move one member's seat between Pro and Max. Team admins only; the
 * Max upgrades apply immediately with proration; Pro downgrades start at renewal.
 */
export function useSetTeamMemberPlanMutation(
  callbacks?: SetTeamMemberPlanCallbacks
) {
  return useMutation(() => ({
    mutationFn: async ({ userId, plan }: SetTeamMemberPlanArgs) => {
      await throwOnErr(() => authServiceClient.setTeamMemberPlan(userId, plan));
    },

    ...withCallbacks<void, Error, SetTeamMemberPlanArgs>(
      {
        onSuccess: (_data, { teamId, plan }) => {
          fireAndForget(invalidateTeam(teamId), 'team-settings');
          fireAndForget(invalidateAiBillingSummary(), 'team-settings');
          fireAndForget(invalidateSubscriptionStatus(), 'team-settings');
          toast.success(
            plan === 'max'
              ? 'Max applies immediately. Any pending downgrade is canceled.'
              : 'Pro is scheduled for the next renewal. This seat keeps Max until then.'
          );
        },

        onError: (error) => {
          console.error('Failed to change team member plan', error);
          toast.failure("Couldn't change the seat's plan. Please try again.");
        },
      },
      callbacks
    ),
  }));
}
