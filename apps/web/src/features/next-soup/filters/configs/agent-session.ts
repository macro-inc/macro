import { agentSessionsFilter as agentSessionsPredicate } from '../predicates';
import { config } from './base';

/**
 * Agent coding sessions (the `agent_session` entity). The server side is
 * opt-in (`includeAgentSessions`), so the query half only needs to say
 * "sessions are wanted"; the predicate keeps optimistic websocket inserts
 * of other types out of the Sessions tab.
 */
export const agentSessionFilter = config({
  id: 'agent-session',
  predicate: agentSessionsPredicate,
  query: { include: { includeAgentSessions: true } },
});
