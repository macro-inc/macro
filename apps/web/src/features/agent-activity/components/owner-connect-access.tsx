import { useUserId } from '@core/context/user';
import { ConnectCardAccessContext } from '@core/pipedream/connection-context';
import { useAgentSessionQuery } from '@queries/agent-session/session';
import type { ParentProps } from 'solid-js';

/**
 * Connect cards an agent session presented, shown outside that session (a
 * channel reply): only the session's owner may press them, as in the session
 * itself. While the owner is unknown, no one may.
 */
export function OwnerConnectAccess(props: ParentProps<{ sessionId: string }>) {
  const userId = useUserId();
  const session = useAgentSessionQuery(() => props.sessionId);
  const allowed = () => {
    const reader = userId();
    return reader !== undefined && session.data?.ownerId === reader;
  };
  return (
    <ConnectCardAccessContext.Provider value={{ allowed }}>
      {props.children}
    </ConnectCardAccessContext.Provider>
  );
}
