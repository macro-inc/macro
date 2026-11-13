import { AgentRequests } from '../components/agent-requests';
import { createAgentRequests } from '../primitives/agent-requests';
import type { AgentRequestSource } from '../queries/agent-requests';

/** Review of one item's agents, for people who can manage the item. */
export function ItemAgentRequests(props: {
  source: AgentRequestSource;
  itemId: string;
}) {
  const requests = createAgentRequests(props.source, () => props.itemId);
  return (
    <AgentRequests
      states={requests.shown()}
      nameOf={requests.nameOf}
      busy={requests.busy()}
      stale={requests.stale()}
      failed={requests.failed()}
      onResolve={requests.resolve}
      onRevoke={requests.revoke}
    />
  );
}
