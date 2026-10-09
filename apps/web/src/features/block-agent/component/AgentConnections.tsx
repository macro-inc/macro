import { toast } from '@core/component/Toast/Toast';
import { AppConnectionContext } from '@core/pipedream/connection-context';
import { connectPipedreamApp } from '@queries/pipedream-connectors';
import type { ParentProps } from 'solid-js';
import { useAgentSession } from '../context/AgentSessionContext';
import { createConnectorContinuation } from '../primitives/create-connector-continuation';
import { promptActionOf } from './prompt-action';

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
    resume: async (name) => {
      const result = await state.issue(
        promptActionOf(
          `I connected ${name}. Continue my previous request using the newly available tools.`,
          []
        )
      );
      if (!result || result.isErr())
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
