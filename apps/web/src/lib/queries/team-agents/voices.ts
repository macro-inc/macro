import type { VoicePickerSource } from '@app/features/settings/core/voices';
import { fireAndForget } from '@core/util/fireAndForget';
import { throwOnErr } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import { authServiceClient } from '@service-auth/client';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { queryReadyGate } from '../gate';
import { teamAgentKeys } from './keys';

const voiceCatalogOptions = (teamId: string) =>
  queryOptions({
    queryKey: teamAgentKeys.voices(teamId).queryKey,
    queryFn: () =>
      Telemetry.span('team-agent.voices.load', () =>
        throwOnErr(() => agentHarnessServiceClient.voices())
      ),
    staleTime: 86400000,
  });
const voiceSampleOptions = (teamId: string, model: string) =>
  queryOptions({
    queryKey: teamAgentKeys.sample(teamId, model).queryKey,
    queryFn: () =>
      Telemetry.span('team-agent.voice.sample', () =>
        throwOnErr(() => agentHarnessServiceClient.voiceSample(model))
      ),
    staleTime: 86400000,
  });
const agentVoiceOptions = (teamId: string, userId: string) =>
  queryOptions({
    queryKey: teamAgentKeys.voice(teamId, userId).queryKey,
    queryFn: () =>
      throwOnErr(() => authServiceClient.getTeamAgentVoice(userId)),
  });

export function useVoicePickerSource(
  teamId: Accessor<string>
): VoicePickerSource {
  const catalog = useQuery(() => voiceCatalogOptions(teamId()));
  return {
    choices: () => (queryReadyGate(catalog) ? catalog.data : []),
    loading: () => catalog.isLoading,
    failed: () => catalog.isError,
    retry: () => fireAndForget(catalog.refetch(), 'team-agent.voices.retry'),
    sample: (model) =>
      queryClient.fetchQuery(voiceSampleOptions(teamId(), model)),
  };
}

export function useAgentVoice(
  teamId: Accessor<string>,
  userId: Accessor<string>
) {
  const query = useQuery(() => agentVoiceOptions(teamId(), userId()));
  const update = useMutation(() => ({
    mutationFn: async (model: string) => {
      const team = teamId();
      const user = userId();
      const voice = await Telemetry.span('team-agent.voice.save', () =>
        throwOnErr(() => authServiceClient.setTeamAgentVoice(user, { model }))
      );
      return { team, user, voice };
    },
    onSuccess: ({ team, user, voice }) =>
      queryClient.setQueryData(teamAgentKeys.voice(team, user).queryKey, voice),
  }));
  return { query, update };
}
