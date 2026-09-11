import { throwOnErr } from '@core/util/result';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import type {
  ControlRequest,
  CreateAgentSessionRequest,
} from '@service-agent-harness/generated/schemas';
import { useMutation } from '@tanstack/solid-query';

export function useCreateAgentSessionMutation() {
  return useMutation(() => ({
    retry: false,
    mutationFn: (request: CreateAgentSessionRequest) =>
      throwOnErr(() => agentHarnessServiceClient.create(request)),
  }));
}

export function useAgentSessionControlMutation() {
  return useMutation(() => ({
    retry: false,
    mutationFn: (vars: { sessionId: string; request: ControlRequest }) =>
      throwOnErr(() =>
        agentHarnessServiceClient.control(vars.sessionId, vars.request)
      ),
  }));
}
