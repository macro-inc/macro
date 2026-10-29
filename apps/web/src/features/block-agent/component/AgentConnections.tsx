import { toast } from '@core/component/Toast/Toast';
import { AppConnectionContext } from '@core/pipedream/connection-context';
import { reportAgentSessionAppConnected } from '@queries/agent-session/app-connections';
import { connectPipedreamApp } from '@queries/pipedream-connectors';
import type { ParentProps } from 'solid-js';
import { useAgentSession } from '../context/AgentSessionContext';
import { createConnectorContinuation } from '../primitives/create-connector-continuation';

/** Authorization belongs to the session transcript, independently of its draft. */
export function AgentConnections(props: ParentProps) {
  const state = useAgentSession();
  const continuation = createConnectorContinuation({
    disabled: () =>
      !state.sessionId() ||
      state.pending() ||
      state.loadFailed() ||
      state.session()?.canEdit !== true ||
      state.session()?.ownerId !== state.userId() ||
      state.session()?.isArchived === true ||
      !['idle', 'disconnected'].includes(state.turn()) ||
      state.queue.entries().length > 0,
    revision: () =>
      `${state.sessionId()}:${state
        .messages()
        .map((message) => `${message.turn}:${message.author.kind}`)
        .join(',')}`,
    connect: connectPipedreamApp,
    resume: async (app) => {
      const sessionId = state.sessionId();
      if (!sessionId) throw new Error('No agent session to continue');
      const result = await reportAgentSessionAppConnected(
        sessionId,
        app.appSlug
      );
      if (result.isErr())
        throw new Error('Could not continue the agent session');
    },
    notify: (message) => toast.alert(message),
  });
  return (
    <AppConnectionContext.Provider value={continuation}>
      {props.children}
    </AppConnectionContext.Provider>
  );
}
