/**
 * Control actions on a live agent session: prompt, stop, model change.
 *
 * One mutation for the one endpoint. The service owns ordering (a prompt
 * posted mid-turn waits in the session's server-side queue), so there is no
 * optimistic cache to maintain here; what the caller gets back is the
 * accepted action's id, which the fold stamps as `requestId` on the folded
 * message the action derives.
 */

import { throwOnErr } from '@core/util/result';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import type {
  ControlRequest,
  ControlResponse,
} from '@service-agent-harness/generated/schemas';
import { useMutation } from '@tanstack/solid-query';

/** One control POST: the session it targets and the action it carries. */
export type AgentSessionControlVars = {
  sessionId: string;
  action: ControlRequest;
};

/** The shape a caller uses to issue control actions, mutation or fake. */
export type AgentSessionControl = (
  vars: AgentSessionControlVars
) => Promise<ControlResponse>;

/**
 * Post a control action to an agent session.
 *
 * `gcTime: 0`: nothing reads a finished control back out of the cache, so
 * there is no reason to hold it. Failures reject (`throwOnErr`), which is how
 * `mutateAsync` reports them to the composer.
 */
export function useAgentSessionControlMutation(
  callbacks?: MutationCallbacks<
    ControlResponse,
    Error,
    AgentSessionControlVars,
    unknown
  >
) {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async ({ sessionId, action }: AgentSessionControlVars) =>
      await throwOnErr(() =>
        agentHarnessServiceClient.control(sessionId, action)
      ),
    ...withCallbacks<ControlResponse, Error, AgentSessionControlVars, unknown>(
      {},
      callbacks
    ),
  }));
}
