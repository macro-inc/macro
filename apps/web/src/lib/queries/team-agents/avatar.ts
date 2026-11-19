import { refreshProfilePicture } from '@core/signal/profilePicture';
import { throwOnErr } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import { type AgentAvatar, teamAgentsClient } from '@service-auth/team-agents';
import {
  type MutationFunctionContext,
  useMutation,
} from '@tanstack/solid-query';
import { createMemo, onCleanup } from 'solid-js';
import {
  assertQueryAccount,
  isCurrentQueryAccount,
  mutationQueryAccount,
} from '../auth/account-scope';
import { useQueryAccount } from '../auth/use-query-account';

type SetAgentAvatarArgs = { userId: string; avatar: AgentAvatar };

function setAgentAvatar(
  { userId, avatar }: SetAgentAvatarArgs,
  context: MutationFunctionContext
) {
  assertQueryAccount(mutationQueryAccount(context));
  const signal =
    context.meta?.requestSignal instanceof AbortSignal
      ? context.meta.requestSignal
      : undefined;
  return Telemetry.span('team-agent.avatar.save', async (span) => {
    span.setAttr('agent.user_id', userId);
    span.setAttr('avatar.kind', avatar.face ? 'face' : 'photo');
    span.setAttr('avatar.has_url', avatar.url !== null);
    await throwOnErr(() => teamAgentsClient.setAvatar(userId, avatar, signal));
  });
}

/** Saves an agent's picture, then shows it wherever its picture is drawn. */
export function useSetAgentAvatarMutation() {
  const account = useQueryAccount();
  const requestSignal = createMemo(() => {
    account();
    const controller = new AbortController();
    onCleanup(() => controller.abort());
    return controller.signal;
  });
  return useMutation(() => ({
    gcTime: 0,
    meta: { queryAccount: account(), requestSignal: requestSignal() },
    retry: false,
    mutationFn: setAgentAvatar,
    onSuccess: (_: void, vars: SetAgentAvatarArgs, _result, context) => {
      if (!isCurrentQueryAccount(mutationQueryAccount(context))) return;
      return refreshProfilePicture(vars.userId);
    },
  }));
}
