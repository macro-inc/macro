import { defineQueryFilters } from '../filter-store/compile';
import { agentSessionFilter as agentSessionPredicate } from '../predicates';
import { config } from './base';

// Agent sessions are opt-in server-side, so naming `includeAgentSessions`
// both surfaces them and — via defineQueryFilters, which NIL-excludes every
// unreferenced target — keeps the query sessions-only. Like reminders, there
// is no `asf` entry in ID_FIELD_NAMES to skip.
export const agentSessionEntityFilter = config({
  id: 'agent-session',
  predicate: agentSessionPredicate,
  query: defineQueryFilters({ include: { includeAgentSessions: true } }),
});
