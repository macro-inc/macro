import { throwOnErr } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import { type AgentVoice, teamAgentsClient } from '@service-auth/team-agents';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { teamAgentKeys } from './keys';

const DAY_MS = 86_400_000;

type SetAgentVoiceArgs = { teamId: string; userId: string; model: string };

// Cached callbacks outlive the hooks; keep hook scope out of these closures.
function voiceCatalogOptions(teamId: string) {
  return queryOptions({
    queryKey: teamAgentKeys.voices(teamId).queryKey,
    enabled: !!teamId,
    queryFn: () =>
      Telemetry.span('team-agent.voices.load', async (span) => {
        span.setAttr('team.id', teamId);
        const voices = await throwOnErr(agentHarnessServiceClient.voices);
        span.setAttr('voice.count', voices.length);
        return voices;
      }),
    staleTime: DAY_MS,
  });
}

function voiceSampleOptions(teamId: string, model: string) {
  return queryOptions({
    queryKey: teamAgentKeys.voiceSample(teamId, model).queryKey,
    queryFn: () =>
      Telemetry.span('team-agent.voice.sample', async (span) => {
        span.setAttr('team.id', teamId);
        span.setAttr('voice.model', model);
        const bytes = await throwOnErr(() =>
          agentHarnessServiceClient.voiceSample(model)
        );
        span.setAttr('sample.bytes', bytes.byteLength);
        return bytes;
      }),
    // The server caches a sample for a day, and its first play bills the team.
    staleTime: DAY_MS,
    gcTime: DAY_MS,
    retry: false,
  });
}

function agentVoiceOptions(teamId: string, userId: string) {
  return queryOptions({
    queryKey: teamAgentKeys.voice(teamId, userId).queryKey,
    enabled: !!teamId && !!userId,
    queryFn: () =>
      Telemetry.span('team-agent.voice.load', async (span) => {
        span.setAttr('team.id', teamId);
        span.setAttr('agent.user_id', userId);
        return await throwOnErr(() => teamAgentsClient.voice(userId));
      }),
  });
}

/** The voices an agent teammate can speak with. Team admins only. */
export function useVoiceCatalogQuery(teamId: Accessor<string>) {
  return useQuery(() => voiceCatalogOptions(teamId()));
}

/** A voice's sample WAV, fetched once per model and reused. */
export function fetchVoiceSample(teamId: string, model: string) {
  return queryClient.fetchQuery(voiceSampleOptions(teamId, model));
}

/** The agent's saved voice; `null` when it uses the default. */
export function useAgentVoiceQuery(
  teamId: Accessor<string>,
  userId: Accessor<string>
) {
  return useQuery(() => agentVoiceOptions(teamId(), userId()));
}

async function setAgentVoice(vars: SetAgentVoiceArgs) {
  return await Telemetry.span('team-agent.voice.save', async (span) => {
    span.setAttr('team.id', vars.teamId);
    span.setAttr('agent.user_id', vars.userId);
    span.setAttr('voice.model', vars.model);
    try {
      return await throwOnErr(() =>
        teamAgentsClient.setVoice(vars.userId, { model: vars.model })
      );
    } catch (error) {
      span.error('Saving the agent voice failed');
      throw error;
    }
  });
}

export function useSetAgentVoiceMutation() {
  return useMutation(() => ({
    gcTime: 0,
    retry: false,
    mutationFn: setAgentVoice,
    onSuccess: (voice: AgentVoice, vars: SetAgentVoiceArgs) =>
      queryClient.setQueryData(
        teamAgentKeys.voice(vars.teamId, vars.userId).queryKey,
        voice
      ),
  }));
}
