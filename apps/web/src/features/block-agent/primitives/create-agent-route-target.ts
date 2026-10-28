import { createSearchParams } from '@app/lib/split-router';
import { createMemo } from 'solid-js';
import { agentDetailSearch } from '../agent-route';
import type { AgentMessageTarget } from '../core/search-location';

export function createAgentRouteTarget() {
  const [search] = createSearchParams(agentDetailSearch);
  return createMemo<AgentMessageTarget | undefined>(() => {
    search.seek;
    if (search.messageTurn < 0) return;
    return { messageTurn: search.messageTurn, author: search.author };
  });
}
