import type { ParentProps } from 'solid-js';
import { useAgentSession } from '../block-agent/context/AgentSessionContext';
import { AgentComputerScreen } from './agent-computer-screen';

/** Production session boundary shared by the workspace and block hosts. */
export function AgentSessionComputerScreen(props: ParentProps) {
  const session = useAgentSession();
  return (
    <AgentComputerScreen
      sessionId={session.sessionId()}
      botId={session.session()?.botId}
      canEdit={!session.loadFailed() && session.session()?.canEdit === true}
    >
      {props.children}
    </AgentComputerScreen>
  );
}
