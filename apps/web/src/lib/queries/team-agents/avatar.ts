import { refreshProfilePicture } from '@core/signal/profilePicture';
import { throwOnErr } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import {
  type TeamAgentAvatar,
  teamAgentsClient,
} from '@service-auth/team-agents';
import { useMutation } from '@tanstack/solid-query';

type SetAgentAvatarArgs = { userId: string; avatar: TeamAgentAvatar };

function setAgentAvatar({ userId, avatar }: SetAgentAvatarArgs) {
  return Telemetry.span('team-agent.avatar.save', async (span) => {
    span.setAttr('agent.user_id', userId);
    span.setAttr('avatar.kind', avatar.face ? 'face' : 'photo');
    span.setAttr('avatar.has_url', avatar.url !== null);
    await throwOnErr(() => teamAgentsClient.setAvatar(userId, avatar));
  });
}

/** Saves an agent's picture, then shows it wherever its picture is drawn. */
export function useSetAgentAvatarMutation() {
  return useMutation(() => ({
    gcTime: 0,
    retry: false,
    mutationFn: setAgentAvatar,
    onSuccess: (_: void, vars: SetAgentAvatarArgs) =>
      refreshProfilePicture(vars.userId),
  }));
}
