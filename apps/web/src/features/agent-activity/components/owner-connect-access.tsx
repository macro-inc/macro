import { useUserId } from '@core/context/user';
import {
  AppConnectionContext,
  ConnectCardAccessContext,
} from '@core/pipedream/connection-context';
import { useAgentSessionQuery } from '@queries/agent-session/session';
import type { ParentProps } from 'solid-js';

/**
 * Connect cards an agent session presented, shown outside that session (a
 * channel reply): only the session's owner may press them, as in the session
 * itself. While the owner is unknown, no one may. It also hides any session
 * around it (a thread embedded in another session's view), so the cards are
 * judged, and continue, by their own session only.
 */
export function OwnerConnectAccess(props: ParentProps<{ sessionId: string }>) {
  const userId = useUserId();
  const session = useAgentSessionQuery(() => props.sessionId);
  const allowed = () => {
    const reader = userId();
    return reader !== undefined && session.data?.ownerId === reader;
  };
  return (
    <AppConnectionContext.Provider value={undefined}>
      <ConnectCardAccessContext.Provider value={{ allowed }}>
        {props.children}
      </ConnectCardAccessContext.Provider>
    </AppConnectionContext.Provider>
  );
}
